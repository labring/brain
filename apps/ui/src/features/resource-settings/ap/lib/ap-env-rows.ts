export interface ApEnvRow {
  compiledReference?: ApEnvCompiledReferenceMetadata;
  dbDsn?: ApEnvDbDsnReference;
  helper?: ApEnvHelperMetadata;
  name: string;
  referenceDbKey?: string;
  value: string;
  valueFrom?: unknown;
  valueSource?: "direct" | "valueFrom" | "dbDsn";
}

export type ApEnvDbDsnField = "private" | "public";
export type ApEnvDbPrimitiveField = "host" | "password" | "port" | "username";
export type ApEnvDbReferenceField = ApEnvDbDsnField | ApEnvDbPrimitiveField;

export interface ApEnvSecretKeyRef {
  key: string;
  name: string;
}

export interface ApEnvDbDsnReference {
  dbName: string;
  dbNamespace: string;
  field: ApEnvDbReferenceField;
}

export interface ApEnvDbDsnSource {
  engine?: string;
  name: string;
  namespace: string;
  primitiveSecretRefs?: Partial<
    Record<ApEnvDbPrimitiveField, ApEnvSecretKeyRef>
  >;
  privateDsn?: string;
  publicDsn?: string;
  variables?: ApEnvDbReferenceVariable[];
}

export interface ApEnvDbDsnReferenceTarget {
  name: string;
  namespace: string;
}

export interface ApEnvHelperMetadata {
  automatic: boolean;
  sourceDbKey?: string;
  sourceField?: ApEnvDbReferenceField;
}

export interface ApEnvDbReferenceVariable {
  field?: ApEnvDbPrimitiveField | "databaseUrl";
  name: string;
  type: "alias" | "secret" | "value";
  value?: string;
  valueFrom?: { secretKeyRef: ApEnvSecretKeyRef };
}

export interface ApEnvCompiledReferenceMetadata {
  expression: string;
  helpers: {
    field: ApEnvDbPrimitiveField | "databaseUrl";
    name: string;
    valueFrom?: { secretKeyRef: ApEnvSecretKeyRef };
  }[];
}

export interface ApEnvDbDsnFieldOption {
  field: ApEnvDbReferenceField;
  label: string;
  value?: string;
  valueFrom?: { secretKeyRef: ApEnvSecretKeyRef };
}

export interface ApEnvDbPrimitiveFieldOption {
  field: ApEnvDbPrimitiveField;
  label: string;
  valueFrom: { secretKeyRef: ApEnvSecretKeyRef };
}

export type ApEnvDbReferenceRowPatch = Pick<
  ApEnvRow,
  "dbDsn" | "value" | "valueFrom" | "valueSource"
>;

export type ApEnvRowValidationErrorType =
  | "duplicate-name"
  | "invalid-name"
  | "missing-name";

export interface ApEnvRowValidationError {
  index: number;
  message: string;
  type: ApEnvRowValidationErrorType;
}

export interface ApEnvRowValidationResult {
  errors: ApEnvRowValidationError[];
  valid: boolean;
}

export const AP_ENV_VALUE_FROM_PLACEHOLDER = "(valueFrom)";

const K8S_ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const DEFAULT_ROW_NAME = "NEW_VARIABLE";
const PRIMITIVE_FIELD_LABELS: Record<ApEnvDbPrimitiveField, string> = {
  host: "Host",
  password: "Password",
  port: "Port",
  username: "Username",
};
export const AP_ENV_DB_SECRET_KEY_CANDIDATES: Record<
  ApEnvDbPrimitiveField,
  readonly string[]
> = {
  host: ["host", "endpoint"],
  password: ["password", "passwd"],
  port: ["port"],
  username: ["username", "user"],
};
export const AP_ENV_DB_PRIMITIVE_FIELD_ORDER: readonly ApEnvDbPrimitiveField[] =
  ["username", "password", "host", "port"];

function nextDefaultRowName(rows: readonly ApEnvRow[]): string {
  return nextAvailableEnvRowName(rows, DEFAULT_ROW_NAME);
}

function nextAvailableEnvRowName(
  rows: readonly ApEnvRow[],
  baseName: string
): string {
  const used = new Set(rows.map((row) => row.name.trim()).filter(Boolean));
  if (!used.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (used.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}_${suffix}`;
}

function nonEmptyValue(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function isPrimitiveDbReferenceField(
  field: ApEnvDbReferenceField
): field is ApEnvDbPrimitiveField {
  return field !== "private" && field !== "public";
}

export function isKubernetesEnvName(name: string): boolean {
  return K8S_ENV_NAME_RE.test(name);
}

/**
 * The private/public entries carry the DB Connection Template as `value` for
 * address matching only (connection evidence, pasted-DSN recognition). They
 * are not an insertion vocabulary: inserting a DSN as an AP Environment
 * Reference goes through the raw-source `${{db.DATABASE_URL}}` compile, which
 * composes it from the primitive Secret references.
 */
export function apEnvDbDsnFieldOptions(
  source: ApEnvDbDsnSource | undefined
): ApEnvDbDsnFieldOption[] {
  const options: ApEnvDbDsnFieldOption[] = [];
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

  return [...options, ...apEnvDbPrimitiveFieldOptions(source)];
}

const CONNECTION_ADDRESS_RE =
  /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/?#]+)/;

/**
 * Extracts the `scheme://host:port` address from a connection-string value.
 * Works for both complete DB Connection DSNs and DB Connection Templates
 * (whose `<username>:<password>` userinfo is stripped like any other).
 */
function connectionAddressFromDsnValue(value: string): string | undefined {
  const match = CONNECTION_ADDRESS_RE.exec(value.trim());
  const scheme = match?.[1];
  const hostPort = match?.[2];
  if (scheme === undefined || hostPort === undefined) {
    return undefined;
  }
  return `${scheme.toLowerCase()}://${hostPort.toLowerCase()}`;
}

/**
 * Connection evidence (ADR-0002, revised by ADR-0053): a literal env value
 * points at a DB DSN field when its address matches, so pasted complete DSNs
 * keep matching the credential-free templates that DB read surfaces carry,
 * and survive password rotation.
 */
function dsnValueMatchesFieldOption(
  field: ApEnvDbDsnFieldOption,
  value: string
): boolean {
  if (field.value === undefined) {
    return false;
  }
  if (field.value === value) {
    return true;
  }
  const fieldAddress = connectionAddressFromDsnValue(field.value);
  return (
    fieldAddress !== undefined &&
    fieldAddress === connectionAddressFromDsnValue(value)
  );
}

export function apEnvDbDsnReferenceFromValue(
  value: string,
  sources: readonly ApEnvDbDsnSource[]
): Pick<ApEnvRow, "dbDsn" | "value" | "valueSource"> | undefined {
  for (const source of sources) {
    for (const field of apEnvDbDsnFieldOptions(source)) {
      if (!dsnValueMatchesFieldOption(field, value)) {
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

export function normalizeApEnvRowsForSave(
  rows: readonly ApEnvRow[]
): ApEnvRow[] {
  return rows.map((row) => {
    const name = row.name.trim();
    if (row.valueSource === "valueFrom" && row.valueFrom != null) {
      return {
        name,
        value: AP_ENV_VALUE_FROM_PLACEHOLDER,
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
          value: AP_ENV_VALUE_FROM_PLACEHOLDER,
          valueFrom: row.valueFrom,
          valueSource: "valueFrom",
        };
      }
      return { name, value: row.value };
    }
    return { name, value: row.value };
  });
}

export function addApEnvRow(rows: readonly ApEnvRow[]): ApEnvRow[] {
  return [...rows, { name: nextDefaultRowName(rows), value: "" }];
}

export function updateApEnvRow(
  rows: readonly ApEnvRow[],
  index: number,
  patch: Partial<ApEnvRow>
): ApEnvRow[] {
  return rows.map((row, rowIndex) =>
    rowIndex === index ? { ...row, ...patch } : row
  );
}

export function deleteApEnvRow(
  rows: readonly ApEnvRow[],
  index: number
): ApEnvRow[] {
  return rows.filter((_, rowIndex) => rowIndex !== index);
}

function valueFromKey(valueFrom: unknown): string {
  return valueFrom == null ? "" : JSON.stringify(valueFrom);
}

function dbDsnReferencesEqual(
  a: ApEnvDbDsnReference | undefined,
  b: ApEnvDbDsnReference | undefined
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
  a: ApEnvHelperMetadata | undefined,
  b: ApEnvHelperMetadata | undefined
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

function rowValueSource(row: ApEnvRow): NonNullable<ApEnvRow["valueSource"]> {
  return row.valueSource ?? "direct";
}

export function apEnvDbReferenceRowPatch(
  source: ApEnvDbDsnSource,
  field: ApEnvDbPrimitiveFieldOption
): ApEnvDbReferenceRowPatch {
  return {
    dbDsn: {
      dbName: source.name,
      dbNamespace: source.namespace,
      field: field.field,
    },
    value: AP_ENV_VALUE_FROM_PLACEHOLDER,
    valueFrom: field.valueFrom,
    valueSource: "dbDsn",
  };
}

function rowSavesAsValueFrom(row: ApEnvRow): boolean {
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
): ApEnvSecretKeyRef | undefined {
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

export function apEnvDbPrimitiveFieldForSecretKey(
  key: string
): { field: ApEnvDbPrimitiveField; priority: number } | undefined {
  for (const field of AP_ENV_DB_PRIMITIVE_FIELD_ORDER) {
    const priority = AP_ENV_DB_SECRET_KEY_CANDIDATES[field].indexOf(key);
    if (priority !== -1) {
      return { field, priority };
    }
  }
  return undefined;
}

export function apEnvDbPrimitiveFieldOptions(
  source: ApEnvDbDsnSource | undefined
): ApEnvDbPrimitiveFieldOption[] {
  const options: ApEnvDbPrimitiveFieldOption[] = [];
  for (const field of AP_ENV_DB_PRIMITIVE_FIELD_ORDER) {
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

export function apEnvDbSecretReferenceFromValueFrom(
  valueFrom: unknown,
  sources: readonly ApEnvDbDsnSource[]
): Pick<ApEnvRow, "dbDsn" | "value" | "valueFrom" | "valueSource"> | undefined {
  const ref = secretKeyRefFromValueFrom(valueFrom);
  if (ref === undefined) {
    return undefined;
  }
  for (const source of sources) {
    for (const field of apEnvDbPrimitiveFieldOptions(source)) {
      const fieldRef = field.valueFrom.secretKeyRef;
      if (fieldRef.name !== ref.name || fieldRef.key !== ref.key) {
        continue;
      }
      return {
        ...apEnvDbReferenceRowPatch(source, field),
        valueFrom,
      };
    }
  }
  return undefined;
}

export function apEnvRowsEqual(
  a: readonly ApEnvRow[],
  b: readonly ApEnvRow[]
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

export function apEnvRowsModelEqual(
  a: readonly ApEnvRow[],
  b: readonly ApEnvRow[]
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

export function validateApEnvRows(
  rows: readonly ApEnvRow[]
): ApEnvRowValidationResult {
  const errors: ApEnvRowValidationError[] = [];
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
