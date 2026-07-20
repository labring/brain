import {
  type ApEnvDbDsnSource,
  type ApEnvDbPrimitiveField,
  type ApEnvDbPrimitiveFieldOption,
  type ApEnvRow,
  apEnvDbPrimitiveFieldOptions,
  apEnvDbReferenceRowPatch,
  isKubernetesEnvName,
  normalizeApEnvRowsForSave,
  validateApEnvRows,
} from "./ap-env-rows";

const EDITOR_TOKEN_RE = /\$\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g;
const K8S_ENV_EXPANSION_RE = /\$\(([A-Za-z_][A-Za-z0-9_.-]*)\)/g;
const DB_HELPER_NAMES: Record<ApEnvDbPrimitiveField, string> = {
  host: "PGHOST",
  password: "PGPASSWORD",
  port: "PGPORT",
  username: "PGUSER",
};

export type EnvTokenDiagnosticType =
  | "duplicate-name"
  | "helper-in-use"
  | "invalid-name"
  | "missing-name"
  | "unresolved-token";

export interface EnvTokenDiagnostic {
  message: string;
  rowIndex?: number;
  token?: string;
  type: EnvTokenDiagnosticType;
}

export interface EnvTokenSaveResult {
  diagnostics: EnvTokenDiagnostic[];
  env: ApEnvRow[];
  valid: boolean;
}

export interface EnvTokenMenuItem {
  description?: string;
  label: string;
  source?: "db" | "env";
  token: string;
}

interface TokenMatch {
  end: number;
  name: string;
  start: number;
}

interface HelperSpec {
  dbKey: string;
  field: ApEnvDbPrimitiveField;
  name: string;
  patch: Pick<ApEnvRow, "dbDsn" | "value" | "valueFrom" | "valueSource">;
}

interface SourceFieldMatch {
  field: ApEnvDbPrimitiveFieldOption;
  helperName: string;
  source: ApEnvDbDsnSource;
}

interface ResolveTokenContext {
  dbSources: readonly ApEnvDbDsnSource[];
  existingNames: ReadonlySet<string>;
  ownerByName: ReadonlyMap<string, string>;
  row: ApEnvRow;
  rowIndex: number;
}

interface ResolveTokenResult {
  diagnostic?: EnvTokenDiagnostic;
  helper?: HelperSpec;
  resolved: boolean;
}

export function apEnvDbSourceKey(
  source: Pick<ApEnvDbDsnSource, "name" | "namespace">
): string {
  return `${source.namespace}/${source.name}`;
}

function dbIdentityForName(source: ApEnvDbDsnSource): string {
  return source.name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function helperNameWithConflicts({
  existingNames,
  field,
  ownerByName,
  source,
}: {
  existingNames: ReadonlySet<string>;
  field: ApEnvDbPrimitiveField;
  ownerByName: ReadonlyMap<string, string>;
  source: ApEnvDbDsnSource;
}): string {
  const dbKey = apEnvDbSourceKey(source);
  const base = DB_HELPER_NAMES[field];
  const owner = ownerByName.get(base);
  if ((!existingNames.has(base) && owner === undefined) || owner === dbKey) {
    return base;
  }

  const identity = dbIdentityForName(source);
  const identityCandidate =
    identity === "" || base.startsWith(`${identity}_`)
      ? `${base}_${identity || "DB"}`
      : `${identity}_${base}`;
  let candidate = identityCandidate;
  let suffix = 2;
  while (
    (existingNames.has(candidate) || ownerByName.has(candidate)) &&
    ownerByName.get(candidate) !== dbKey
  ) {
    candidate = `${identityCandidate}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function parseEditorTokens(value: string): TokenMatch[] {
  const matches: TokenMatch[] = [];
  for (const match of value.matchAll(EDITOR_TOKEN_RE)) {
    const name = match[1];
    if (name === undefined || match.index === undefined) {
      continue;
    }
    matches.push({
      end: match.index + match[0].length,
      name,
      start: match.index,
    });
  }
  return matches;
}

export function apEnvValueToEditorTokens(value: string): string {
  return value.replaceAll(K8S_ENV_EXPANSION_RE, (_match, name: string) => {
    return `\${{${name}}}`;
  });
}

export function apEnvValueToKubernetesExpansion(value: string): string {
  return value.replaceAll(EDITOR_TOKEN_RE, (_match, name: string) => {
    return `$(${name})`;
  });
}

function rowIsAutomaticHelper(row: ApEnvRow): boolean {
  return row.helper?.automatic === true;
}

function rowDbKey(row: ApEnvRow): string {
  if (row.dbDsn == null) {
    return "";
  }
  return `${row.dbDsn.dbNamespace}/${row.dbDsn.dbName}`;
}

function sourceFromKey(
  dbSources: readonly ApEnvDbDsnSource[],
  key: string | undefined
): ApEnvDbDsnSource | undefined {
  if (key == null || key === "") {
    return undefined;
  }
  return dbSources.find((source) => apEnvDbSourceKey(source) === key);
}

function fieldOptionByName(
  source: ApEnvDbDsnSource,
  tokenName: string,
  existingNames: ReadonlySet<string>,
  ownerByName: ReadonlyMap<string, string>
): SourceFieldMatch | undefined {
  for (const field of apEnvDbPrimitiveFieldOptions(source)) {
    const helperName = helperNameWithConflicts({
      existingNames,
      field: field.field,
      ownerByName,
      source,
    });
    if (helperName === tokenName) {
      return { field, helperName, source };
    }
  }
  return undefined;
}

function findDbTokenMatch(
  dbSources: readonly ApEnvDbDsnSource[],
  row: ApEnvRow,
  tokenName: string,
  existingNames: ReadonlySet<string>,
  ownerByName: ReadonlyMap<string, string>
): SourceFieldMatch | undefined {
  const selectedSource = sourceFromKey(dbSources, row.referenceDbKey);
  if (selectedSource !== undefined) {
    return fieldOptionByName(
      selectedSource,
      tokenName,
      existingNames,
      ownerByName
    );
  }

  let match: SourceFieldMatch | undefined;
  for (const source of dbSources) {
    const sourceMatch = fieldOptionByName(
      source,
      tokenName,
      existingNames,
      ownerByName
    );
    if (sourceMatch === undefined) {
      continue;
    }
    if (match !== undefined) {
      return undefined;
    }
    match = sourceMatch;
  }
  return match;
}

function helperSpecForMatch(match: SourceFieldMatch): HelperSpec {
  const dbKey = apEnvDbSourceKey(match.source);
  return {
    dbKey,
    field: match.field.field,
    name: match.helperName,
    patch: apEnvDbReferenceRowPatch(match.source, match.field),
  };
}

function resolveTokenName({
  dbSources,
  existingNames,
  ownerByName,
  row,
  rowIndex,
  tokenName,
}: ResolveTokenContext & { tokenName: string }): ResolveTokenResult {
  if (existingNames.has(tokenName)) {
    return { resolved: true };
  }

  const match = findDbTokenMatch(
    dbSources,
    row,
    tokenName,
    existingNames,
    ownerByName
  );
  if (match === undefined) {
    return {
      diagnostic: {
        message:
          row.referenceDbKey == null || row.referenceDbKey === ""
            ? `Choose a Reference or create ${tokenName}.`
            : `${tokenName} is not available from the selected Reference.`,
        rowIndex,
        token: tokenName,
        type: "unresolved-token",
      },
      resolved: false,
    };
  }

  const helper = helperSpecForMatch(match);
  const owner = ownerByName.get(helper.name);
  if (owner !== undefined && owner !== helper.dbKey) {
    return {
      diagnostic: {
        message: `${helper.name} is already owned by another DB reference.`,
        rowIndex,
        token: tokenName,
        type: "unresolved-token",
      },
      resolved: false,
    };
  }
  return { helper, resolved: true };
}

function referencedTokenNames(rows: readonly ApEnvRow[]): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    for (const token of parseEditorTokens(row.value)) {
      names.add(token.name);
    }
  }
  return names;
}

function firstReferenceIndexByToken(
  rows: readonly ApEnvRow[]
): Map<string, number> {
  const first = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const token of parseEditorTokens(row.value)) {
      if (!first.has(token.name)) {
        first.set(token.name, index);
      }
    }
  });
  return first;
}

function rowsWithConvertedSavedValues(rows: readonly ApEnvRow[]): ApEnvRow[] {
  return rows.map((row) => ({
    ...row,
    value:
      row.valueSource === "valueFrom"
        ? row.value
        : apEnvValueToKubernetesExpansion(row.value),
  }));
}

function rowsWithInferredReferenceDbKeys(
  rows: readonly ApEnvRow[]
): ApEnvRow[] {
  const helperSourceByName = new Map<string, string>();
  for (const row of rows) {
    const sourceDbKey = row.helper?.sourceDbKey;
    if (sourceDbKey != null && sourceDbKey !== "") {
      helperSourceByName.set(row.name, sourceDbKey);
    }
  }

  return rows.map((row) => {
    if (row.helper != null) {
      return row;
    }
    const sourceKeys = new Set<string>();
    for (const token of parseEditorTokens(row.value)) {
      const sourceKey = helperSourceByName.get(token.name);
      if (sourceKey == null || sourceKey === "") {
        return row;
      }
      sourceKeys.add(sourceKey);
    }
    if (sourceKeys.size !== 1) {
      return row;
    }
    const [referenceDbKey] = Array.from(sourceKeys);
    return referenceDbKey == null ? row : { ...row, referenceDbKey };
  });
}

function stripTokenMetadata(rows: readonly ApEnvRow[]): ApEnvRow[] {
  return rows.map(
    ({ helper: _helper, referenceDbKey: _referenceDbKey, ...row }) => row
  );
}

function helperRowFromSpec(spec: HelperSpec): ApEnvRow {
  return {
    ...spec.patch,
    helper: {
      automatic: true,
      sourceDbKey: spec.dbKey,
      sourceField: spec.field,
    },
    name: spec.name,
  };
}

function sortRowsWithHelpersNearFirstUse(
  rows: readonly ApEnvRow[]
): ApEnvRow[] {
  const firstUse = firstReferenceIndexByToken(rows);
  const helperByName = new Map<string, ApEnvRow>();
  const baseRows: ApEnvRow[] = [];
  for (const row of rows) {
    if (rowIsAutomaticHelper(row)) {
      helperByName.set(row.name, row);
    } else {
      baseRows.push(row);
    }
  }

  const out: ApEnvRow[] = [];
  baseRows.forEach((row, baseIndex) => {
    out.push(row);
    const helperNames = Array.from(helperByName.keys()).filter(
      (name) => firstUse.get(name) === baseIndex
    );
    helperNames.sort();
    for (const name of helperNames) {
      const helper = helperByName.get(name);
      if (helper !== undefined) {
        out.push(helper);
        helperByName.delete(name);
      }
    }
  });
  out.push(...helperByName.values());
  return out;
}

function automaticHelperOwnerByName(
  rows: readonly ApEnvRow[]
): Map<string, string> {
  const ownerByName = new Map<string, string>();
  for (const row of rows) {
    if (!rowIsAutomaticHelper(row)) {
      continue;
    }
    const owner = row.helper?.sourceDbKey ?? rowDbKey(row);
    if (owner !== "") {
      ownerByName.set(row.name, owner);
    }
  }
  return ownerByName;
}

function helperEquivalent(row: ApEnvRow, spec: HelperSpec): boolean {
  if (row.valueSource !== spec.patch.valueSource) {
    return false;
  }
  if (row.value !== spec.patch.value) {
    return false;
  }
  if (
    JSON.stringify(row.valueFrom ?? null) !==
    JSON.stringify(spec.patch.valueFrom ?? null)
  ) {
    return false;
  }
  return rowDbKey(row) === spec.dbKey && row.dbDsn?.field === spec.field;
}

function helperMetadataFromSavedRow(
  row: ApEnvRow
): ApEnvRow["helper"] | undefined {
  if (row.helper != null) {
    return row.helper;
  }
  if (row.valueSource !== "dbDsn" || row.dbDsn == null) {
    return undefined;
  }
  return {
    automatic: false,
    sourceDbKey: rowDbKey(row),
    sourceField: row.dbDsn.field,
  };
}

export function refreshApEnvTokenDraft(
  rows: readonly ApEnvRow[],
  dbSources: readonly ApEnvDbDsnSource[] = []
): { diagnostics: EnvTokenDiagnostic[]; rows: ApEnvRow[] } {
  const referenced = referencedTokenNames(rows);
  const keptRows = rows.filter(
    (row) => !rowIsAutomaticHelper(row) || referenced.has(row.name)
  );
  const existingNames = new Set(
    keptRows.map((row) => row.name).filter(Boolean)
  );
  const ownerByName = automaticHelperOwnerByName(keptRows);
  const diagnostics: EnvTokenDiagnostic[] = [];
  const helperByName = new Map<string, HelperSpec>();

  keptRows.forEach((row, rowIndex) => {
    if (rowIsAutomaticHelper(row)) {
      return;
    }
    for (const token of parseEditorTokens(row.value)) {
      const result = resolveTokenName({
        dbSources,
        existingNames,
        ownerByName,
        row,
        rowIndex,
        tokenName: token.name,
      });
      if (result.diagnostic !== undefined) {
        diagnostics.push(result.diagnostic);
      }
      if (result.helper !== undefined) {
        helperByName.set(result.helper.name, result.helper);
        existingNames.add(result.helper.name);
        ownerByName.set(result.helper.name, result.helper.dbKey);
      }
    }
  });

  const nextRows = [...keptRows];
  for (const helper of helperByName.values()) {
    const existingIndex = nextRows.findIndex((row) => row.name === helper.name);
    if (existingIndex === -1) {
      nextRows.push(helperRowFromSpec(helper));
      continue;
    }
    const existing = nextRows[existingIndex];
    if (
      existing !== undefined &&
      rowIsAutomaticHelper(existing) &&
      helperEquivalent(existing, helper)
    ) {
      nextRows[existingIndex] = {
        ...existing,
        helper: {
          automatic: true,
          sourceDbKey: helper.dbKey,
          sourceField: helper.field,
        },
      };
    }
  }

  return {
    diagnostics,
    rows: sortRowsWithHelpersNearFirstUse(nextRows),
  };
}

export function normalizeApEnvTokenRowsForSave(
  rows: readonly ApEnvRow[],
  dbSources: readonly ApEnvDbDsnSource[] = []
): EnvTokenSaveResult {
  const refreshed = refreshApEnvTokenDraft(rows, dbSources);
  const validation = validateApEnvRows(refreshed.rows);
  const diagnostics: EnvTokenDiagnostic[] = [
    ...refreshed.diagnostics,
    ...validation.errors.map((error) => ({
      message: error.message,
      rowIndex: error.index,
      type: error.type,
    })),
  ];

  if (diagnostics.length > 0) {
    return { diagnostics, env: [], valid: false };
  }

  return {
    diagnostics,
    env: normalizeApEnvRowsForSave(
      stripTokenMetadata(rowsWithConvertedSavedValues(refreshed.rows))
    ),
    valid: true,
  };
}

export function apEnvRowsFromSavedEnv(
  rows: readonly ApEnvRow[],
  dbSources: readonly ApEnvDbDsnSource[] = []
): ApEnvRow[] {
  const withEditorValues = rowsWithInferredReferenceDbKeys(
    rows.map((row) => {
      const helper = helperMetadataFromSavedRow(row);
      return {
        ...row,
        ...(helper == null ? {} : { helper }),
        value:
          row.valueSource === "valueFrom"
            ? row.value
            : apEnvValueToEditorTokens(row.value),
      };
    })
  );
  return refreshApEnvTokenDraft(withEditorValues, dbSources).rows;
}

export function deleteApEnvTokenRow(
  rows: readonly ApEnvRow[],
  index: number
): { diagnostic?: EnvTokenDiagnostic; rows: ApEnvRow[] } {
  const row = rows[index];
  if (row === undefined) {
    return { rows: [...rows] };
  }
  if (referencedTokenNames(rows).has(row.name)) {
    return {
      diagnostic: {
        message: `Remove references to \${{${row.name}}} before deleting this helper.`,
        rowIndex: index,
        token: row.name,
        type: "helper-in-use",
      },
      rows: [...rows],
    };
  }
  return { rows: rows.filter((_, rowIndex) => rowIndex !== index) };
}

export function renameApEnvTokenRow(
  rows: readonly ApEnvRow[],
  index: number,
  name: string
): ApEnvRow[] {
  const previousName = rows[index]?.name;
  if (previousName == null || previousName === name) {
    return rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, name } : row
    );
  }
  const tokenRe = new RegExp(
    `\\$\\{\\{${previousName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\}`,
    "g"
  );
  return rows.map((row, rowIndex) => ({
    ...row,
    name: rowIndex === index ? name : row.name,
    value: row.value.replaceAll(tokenRe, `\${{${name}}}`),
  }));
}

export function markApEnvTokenRowManual(row: ApEnvRow): ApEnvRow {
  if (!rowIsAutomaticHelper(row)) {
    if (row.dbDsn == null && row.valueSource !== "dbDsn") {
      return row;
    }
    const {
      dbDsn: _dbDsn,
      helper: _helper,
      referenceDbKey: _referenceDbKey,
      ...next
    } = row;
    return {
      ...next,
      valueSource: next.valueFrom == null ? "direct" : "valueFrom",
    };
  }
  const {
    dbDsn: _dbDsn,
    helper: _helper,
    referenceDbKey: _referenceDbKey,
    ...next
  } = row;
  if (next.valueSource === "dbDsn") {
    return {
      ...next,
      valueSource: next.valueFrom == null ? "direct" : "valueFrom",
    };
  }
  return next;
}

export function updateApEnvTokenRow(
  rows: readonly ApEnvRow[],
  index: number,
  patch: Partial<ApEnvRow>
): ApEnvRow[] {
  const target = rows[index];
  const nextRows =
    target !== undefined &&
    patch.name !== undefined &&
    patch.name !== target.name
      ? renameApEnvTokenRow(rows, index, patch.name)
      : [...rows];

  return nextRows.map((row, rowIndex) => {
    if (rowIndex !== index) {
      return row;
    }
    const sourceChanging =
      patch.value !== undefined ||
      patch.valueFrom !== undefined ||
      patch.valueSource !== undefined ||
      patch.dbDsn !== undefined;
    const merged = { ...row, ...patch };
    return sourceChanging ? markApEnvTokenRowManual(merged) : merged;
  });
}

export function buildApEnvTokenMenuItems({
  dbSources,
  rows,
  row,
}: {
  dbSources: readonly ApEnvDbDsnSource[];
  row: ApEnvRow;
  rows: readonly ApEnvRow[];
}): EnvTokenMenuItem[] {
  const items = new Map<string, EnvTokenMenuItem>();
  for (const candidate of rows) {
    const name = candidate.name.trim();
    if (name === "" || !isKubernetesEnvName(name) || name === row.name) {
      continue;
    }
    items.set(name, {
      description: "Environment variable",
      label: name,
      source: "env",
      token: name,
    });
  }

  const selectedSource = sourceFromKey(dbSources, row.referenceDbKey);
  if (selectedSource !== undefined) {
    const existingNames = new Set(
      rows
        .filter((candidate) => !rowIsAutomaticHelper(candidate))
        .map((candidate) => candidate.name)
        .filter(Boolean)
    );
    const ownerByName = automaticHelperOwnerByName(rows);
    for (const field of apEnvDbPrimitiveFieldOptions(selectedSource)) {
      const token = helperNameWithConflicts({
        existingNames,
        field: field.field,
        ownerByName,
        source: selectedSource,
      });
      items.set(token, {
        description: `${selectedSource.name} secret`,
        label: token,
        source: "db",
        token,
      });
    }
  }

  return Array.from(items.values());
}

export function insertApEnvTokenText(
  value: string,
  token: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): string {
  const safeToken = `\${{${token}}}`;
  const start = Math.max(
    0,
    Math.min(value.length, selectionStart ?? value.length)
  );
  const end = Math.max(start, Math.min(value.length, selectionEnd ?? start));
  return `${value.slice(0, start)}${safeToken}${value.slice(end)}`;
}

export function unresolvedApEnvTokenDiagnostics(
  rows: readonly ApEnvRow[],
  dbSources: readonly ApEnvDbDsnSource[] = []
): EnvTokenDiagnostic[] {
  return refreshApEnvTokenDraft(rows, dbSources).diagnostics;
}
