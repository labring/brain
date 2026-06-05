export interface ContainerEnvRow {
  dbDsn?: ContainerEnvDbDsnReference;
  helper?: ContainerEnvHelperMetadata;
  name: string;
  referenceDbKey?: string;
  value: string;
  valueFrom?: unknown;
  valueSource?: "direct" | "valueFrom" | "dbDsn";
}

export type ContainerEnvDbDsnField = "private" | "public";
export type ContainerEnvDbPrimitiveField =
  | "host"
  | "password"
  | "port"
  | "username";
export type ContainerEnvDbReferenceField =
  | ContainerEnvDbDsnField
  | ContainerEnvDbPrimitiveField;

export interface ContainerEnvSecretKeyRef {
  key: string;
  name: string;
}

export interface ContainerEnvDbDsnReference {
  dbName: string;
  dbNamespace: string;
  field: ContainerEnvDbReferenceField;
}

export interface ContainerEnvDbDsnSource {
  name: string;
  namespace: string;
  primitiveSecretRefs?: Partial<
    Record<ContainerEnvDbPrimitiveField, ContainerEnvSecretKeyRef>
  >;
  privateDsn?: string;
  publicDsn?: string;
}

export interface ContainerEnvDbDsnReferenceTarget {
  name: string;
  namespace: string;
}

export interface ContainerEnvHelperMetadata {
  automatic: boolean;
  sourceDbKey?: string;
  sourceField?: ContainerEnvDbReferenceField;
}

export interface ContainerEnvDbDsnFieldOption {
  field: ContainerEnvDbReferenceField;
  label: string;
  value?: string;
  valueFrom?: { secretKeyRef: ContainerEnvSecretKeyRef };
}

export type ContainerEnvDbReferenceRowPatch = Pick<
  ContainerEnvRow,
  "dbDsn" | "value" | "valueFrom" | "valueSource"
>;

export type ContainerEnvRowValidationErrorType =
  | "duplicate-name"
  | "invalid-name"
  | "missing-name";

export interface ContainerEnvRowValidationError {
  index: number;
  message: string;
  type: ContainerEnvRowValidationErrorType;
}

export interface ContainerEnvRowValidationResult {
  errors: ContainerEnvRowValidationError[];
  valid: boolean;
}

export const CONTAINER_ENV_VALUE_FROM_PLACEHOLDER = "(valueFrom)";

const K8S_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const DEFAULT_ROW_NAME = "NEW_VARIABLE";
const PRIMITIVE_FIELD_LABELS: Record<ContainerEnvDbPrimitiveField, string> = {
  host: "Host",
  password: "Password",
  port: "Port",
  username: "Username",
};
export const CONTAINER_ENV_DB_SECRET_KEY_CANDIDATES: Record<
  ContainerEnvDbPrimitiveField,
  readonly string[]
> = {
  host: ["host", "endpoint"],
  password: ["password", "passwd"],
  port: ["port"],
  username: ["username", "user"],
};
export const CONTAINER_ENV_DB_PRIMITIVE_FIELD_ORDER: readonly ContainerEnvDbPrimitiveField[] =
  ["username", "password", "host", "port"];

function nextDefaultRowName(rows: readonly ContainerEnvRow[]): string {
  const used = new Set(rows.map((row) => row.name.trim()).filter(Boolean));
  if (!used.has(DEFAULT_ROW_NAME)) {
    return DEFAULT_ROW_NAME;
  }
  let suffix = 2;
  while (used.has(`${DEFAULT_ROW_NAME}_${suffix}`)) {
    suffix += 1;
  }
  return `${DEFAULT_ROW_NAME}_${suffix}`;
}

function nonEmptyValue(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function isPrimitiveDbReferenceField(
  field: ContainerEnvDbReferenceField
): field is ContainerEnvDbPrimitiveField {
  return field !== "private" && field !== "public";
}

function valueForDbReferenceField(field: ContainerEnvDbDsnFieldOption): string {
  return field.value ?? CONTAINER_ENV_VALUE_FROM_PLACEHOLDER;
}

export function isKubernetesEnvName(name: string): boolean {
  return K8S_ENV_NAME_RE.test(name);
}

export function containerEnvDbDsnFieldOptions(
  source: ContainerEnvDbDsnSource | undefined
): ContainerEnvDbDsnFieldOption[] {
  const options: ContainerEnvDbDsnFieldOption[] = [];
  const privateDsn = nonEmptyValue(source?.privateDsn);
  if (privateDsn !== undefined) {
    options.push({
      field: "private",
      label: "Private DSN",
      value: privateDsn,
    });
  }

  const publicDsn = nonEmptyValue(source?.publicDsn);
  if (publicDsn !== undefined) {
    options.push({
      field: "public",
      label: "Public DSN",
      value: publicDsn,
    });
  }

  return [...options, ...containerEnvDbPrimitiveFieldOptions(source)];
}

export function containerEnvDbDsnReferenceFromValue(
  value: string,
  sources: readonly ContainerEnvDbDsnSource[]
): Pick<ContainerEnvRow, "dbDsn" | "value" | "valueSource"> | undefined {
  for (const source of sources) {
    for (const field of containerEnvDbDsnFieldOptions(source)) {
      if (field.value !== value) {
        continue;
      }
      return {
        dbDsn: {
          dbName: source.name,
          dbNamespace: source.namespace,
          field: field.field,
        },
        value,
        valueSource: "dbDsn",
      };
    }
  }
  return undefined;
}

export function normalizeContainerEnvRowsForSave(
  rows: readonly ContainerEnvRow[]
): ContainerEnvRow[] {
  return rows.map((row) => {
    const name = row.name.trim();
    if (row.valueSource === "valueFrom" && row.valueFrom != null) {
      return {
        name,
        value: CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
        valueFrom: row.valueFrom,
        valueSource: "valueFrom",
      };
    }
    if (row.valueSource === "dbDsn" && row.dbDsn != null) {
      if (
        isPrimitiveDbReferenceField(row.dbDsn.field) &&
        row.valueFrom != null
      ) {
        return {
          name,
          value: CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
          valueFrom: row.valueFrom,
          valueSource: "valueFrom",
        };
      }
      return { name, value: row.value };
    }
    return { name, value: row.value };
  });
}

export function addContainerEnvRow(
  rows: readonly ContainerEnvRow[]
): ContainerEnvRow[] {
  return [...rows, { name: nextDefaultRowName(rows), value: "" }];
}

export function addContainerEnvDbDsnReferenceRow(
  rows: readonly ContainerEnvRow[],
  sources: readonly ContainerEnvDbDsnSource[],
  target?: ContainerEnvDbDsnReferenceTarget
): ContainerEnvRow[] {
  for (const source of sources) {
    if (
      target !== undefined &&
      (source.name !== target.name || source.namespace !== target.namespace)
    ) {
      continue;
    }
    const field = containerEnvDbDsnFieldOptions(source)[0];
    if (field === undefined) {
      continue;
    }
    return [
      ...rows,
      {
        name: nextDefaultRowName(rows),
        ...containerEnvDbReferenceRowPatch(source, field),
      },
    ];
  }

  return [...rows];
}

export function updateContainerEnvRow(
  rows: readonly ContainerEnvRow[],
  index: number,
  patch: Partial<ContainerEnvRow>
): ContainerEnvRow[] {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } : row
  );
}

export function deleteContainerEnvRow(
  rows: readonly ContainerEnvRow[],
  index: number
): ContainerEnvRow[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

function valueFromKey(valueFrom: unknown): string {
  return valueFrom == null ? "" : JSON.stringify(valueFrom);
}

function dbDsnReferencesEqual(
  a: ContainerEnvDbDsnReference | undefined,
  b: ContainerEnvDbDsnReference | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    a.dbName === b.dbName &&
    a.dbNamespace === b.dbNamespace &&
    a.field === b.field
  );
}

function helperMetadataEqual(
  a: ContainerEnvHelperMetadata | undefined,
  b: ContainerEnvHelperMetadata | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    a.automatic === b.automatic &&
    (a.sourceDbKey ?? "") === (b.sourceDbKey ?? "") &&
    (a.sourceField ?? "") === (b.sourceField ?? "")
  );
}

function rowValueSource(
  row: ContainerEnvRow
): NonNullable<ContainerEnvRow["valueSource"]> {
  return row.valueSource ?? "direct";
}

function containerEnvDbReferenceValuePatch(
  field: ContainerEnvDbDsnFieldOption
): Pick<ContainerEnvRow, "value" | "valueFrom"> {
  if (field.valueFrom === undefined) {
    return { value: valueForDbReferenceField(field) };
  }
  return {
    value: CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
    valueFrom: field.valueFrom,
  };
}

export function containerEnvDbReferenceRowPatch(
  source: ContainerEnvDbDsnSource,
  field: ContainerEnvDbDsnFieldOption
): ContainerEnvDbReferenceRowPatch {
  return {
    dbDsn: {
      dbName: source.name,
      dbNamespace: source.namespace,
      field: field.field,
    },
    ...containerEnvDbReferenceValuePatch(field),
    valueSource: "dbDsn",
  };
}

function rowSavesAsValueFrom(row: ContainerEnvRow): boolean {
  if (row.valueSource === "valueFrom" && row.valueFrom != null) {
    return true;
  }
  return (
    row.valueSource === "dbDsn" &&
    row.dbDsn != null &&
    isPrimitiveDbReferenceField(row.dbDsn.field) &&
    row.valueFrom != null
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function secretKeyRefFromValueFrom(
  valueFrom: unknown
): ContainerEnvSecretKeyRef | undefined {
  const valueFromRecord = asRecord(valueFrom);
  const secretKeyRef = asRecord(valueFromRecord?.secretKeyRef);
  const name = secretKeyRef?.name;
  const key = secretKeyRef?.key;
  if (typeof name !== "string" || name === "") {
    return undefined;
  }
  if (typeof key !== "string" || key === "") {
    return undefined;
  }
  return { key, name };
}

export function containerEnvDbPrimitiveFieldForSecretKey(
  key: string
): { field: ContainerEnvDbPrimitiveField; priority: number } | undefined {
  for (const field of CONTAINER_ENV_DB_PRIMITIVE_FIELD_ORDER) {
    const priority = CONTAINER_ENV_DB_SECRET_KEY_CANDIDATES[field].indexOf(key);
    if (priority !== -1) {
      return { field, priority };
    }
  }
  return undefined;
}

function containerEnvDbPrimitiveFieldOptions(
  source: ContainerEnvDbDsnSource | undefined
): ContainerEnvDbDsnFieldOption[] {
  const options: ContainerEnvDbDsnFieldOption[] = [];
  for (const field of CONTAINER_ENV_DB_PRIMITIVE_FIELD_ORDER) {
    const secretKeyRef = source?.primitiveSecretRefs?.[field];
    if (secretKeyRef === undefined) {
      continue;
    }
    options.push({
      field,
      label: PRIMITIVE_FIELD_LABELS[field],
      valueFrom: { secretKeyRef },
    });
  }
  return options;
}

export function containerEnvDbSecretReferenceFromValueFrom(
  valueFrom: unknown,
  sources: readonly ContainerEnvDbDsnSource[]
):
  | Pick<ContainerEnvRow, "dbDsn" | "value" | "valueFrom" | "valueSource">
  | undefined {
  const ref = secretKeyRefFromValueFrom(valueFrom);
  if (ref === undefined) {
    return undefined;
  }
  for (const source of sources) {
    for (const field of containerEnvDbPrimitiveFieldOptions(source)) {
      const fieldRef = field.valueFrom?.secretKeyRef;
      if (fieldRef?.name !== ref.name || fieldRef.key !== ref.key) {
        continue;
      }
      return {
        ...containerEnvDbReferenceRowPatch(source, field),
        valueFrom,
      };
    }
  }
  return undefined;
}

export function containerEnvRowsEqual(
  a: readonly ContainerEnvRow[],
  b: readonly ContainerEnvRow[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((row, index) => {
    const other = b[index];
    if (other == null || row.name !== other.name) {
      return false;
    }

    const rowIsExternal = rowSavesAsValueFrom(row);
    const otherIsExternal = rowSavesAsValueFrom(other);
    if (rowIsExternal !== otherIsExternal) {
      return false;
    }
    if (rowIsExternal) {
      return valueFromKey(row.valueFrom) === valueFromKey(other.valueFrom);
    }
    return row.value === other.value;
  });
}

export function containerEnvRowsModelEqual(
  a: readonly ContainerEnvRow[],
  b: readonly ContainerEnvRow[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((row, index) => {
    const other = b[index];
    if (other == null) {
      return false;
    }
    return (
      row.name === other.name &&
      row.value === other.value &&
      rowValueSource(row) === rowValueSource(other) &&
      (row.referenceDbKey ?? "") === (other.referenceDbKey ?? "") &&
      helperMetadataEqual(row.helper, other.helper) &&
      valueFromKey(row.valueFrom) === valueFromKey(other.valueFrom) &&
      dbDsnReferencesEqual(row.dbDsn, other.dbDsn)
    );
  });
}

export function validateContainerEnvRows(
  rows: readonly ContainerEnvRow[]
): ContainerEnvRowValidationResult {
  const errors: ContainerEnvRowValidationError[] = [];
  const firstIndexByName = new Map<string, number>();

  rows.forEach((row, index) => {
    const name = row.name.trim();
    if (name === "") {
      errors.push({
        index,
        message: "Environment variable name is required.",
        type: "missing-name",
      });
      return;
    }
    if (!isKubernetesEnvName(name)) {
      errors.push({
        index,
        message:
          "Use letters, digits, underscores, dots, or hyphens; do not start with a digit.",
        type: "invalid-name",
      });
      return;
    }

    if (firstIndexByName.has(name)) {
      errors.push({
        index,
        message: "Environment variable names must be unique.",
        type: "duplicate-name",
      });
      return;
    }
    firstIndexByName.set(name, index);
  });

  return { errors, valid: errors.length === 0 };
}
