import {
  CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
  type ContainerEnvDbDsnSource,
  type ContainerEnvDbPrimitiveField,
  type ContainerEnvRow,
  type ContainerEnvSecretKeyRef,
} from "./container-env-rows";

export type ApEnvRawSourceDiagnosticType =
  | "duplicate-name"
  | "invalid-name"
  | "missing-name"
  | "runtime-compile"
  | "syntax"
  | "unresolved-reference";

export interface ApEnvRawSourceDiagnostic {
  key?: string;
  line: number;
  message: string;
  type: ApEnvRawSourceDiagnosticType;
}

export interface ApEnvRawSourceAssignment {
  equalsIndex: number;
  inlineComment: string;
  key: string;
  keyEnd: number;
  keyStart: number;
  line: number;
  quote: "'" | '"' | null;
  raw: string;
  rawValue: string;
  value: string;
  valueEnd: number;
  valueStart: number;
}

interface ApEnvRawSourceTriviaLine {
  kind: "blank" | "comment";
  line: number;
  raw: string;
}

interface ApEnvRawSourceInvalidLine {
  kind: "invalid";
  line: number;
  raw: string;
}

interface ApEnvRawSourceAssignmentLine extends ApEnvRawSourceAssignment {
  kind: "assignment";
}

type ApEnvRawSourceLine =
  | ApEnvRawSourceAssignmentLine
  | ApEnvRawSourceInvalidLine
  | ApEnvRawSourceTriviaLine;

export interface ApEnvRawSourceParseResult {
  diagnostics: ApEnvRawSourceDiagnostic[];
  lines: ApEnvRawSourceLine[];
  rows: ApEnvRawSourceAssignment[];
  source: string;
  valid: boolean;
}

export interface ApEnvRawSourceReferenceSuggestionContext {
  endColumn: number;
  query: string;
  startColumn: number;
}

interface ParsedApEnvRawValue {
  quote: "'" | '"' | null;
  value: string;
}

interface ParsedApEnvRawAssignmentLine {
  diagnostic?: ApEnvRawSourceDiagnostic;
  parsed?: ApEnvRawSourceAssignmentLine;
}

interface ApEnvReferenceToken {
  dbName: string;
  end: number;
  raw: string;
  start: number;
  variableName: string;
}

export interface ApEnvResolvedReferenceToken extends ApEnvReferenceToken {
  canonicalDbName: string;
  canonicalRaw: string;
  canonicalVariableName: ApEnvReferenceVariableName;
  line: number;
  source: ContainerEnvDbDsnSource;
}

export type ApEnvReferenceVariableName =
  | "DATABASE_URL"
  | "PG_HOST"
  | "PG_PASSWORD"
  | "PG_PORT"
  | "PG_USER";

interface ApEnvReferenceVariableOption {
  field: ContainerEnvDbPrimitiveField | "databaseUrl";
  name: ApEnvReferenceVariableName;
  type: "alias" | "secret" | "value";
  value?: string;
  valueFrom?: { secretKeyRef: ContainerEnvSecretKeyRef };
}

interface ApEnvRuntimeCompileContext {
  diagnostics: ApEnvRawSourceDiagnostic[];
  explicitNames: ReadonlySet<string>;
  helperByDbField: Map<string, ContainerEnvRow>;
  helperNameByDbField: Map<string, string>;
  helperNames: Set<string>;
}

interface ApEnvReferenceCompileResult {
  helpers: ContainerEnvRow[];
  helpersUsed: NonNullable<ContainerEnvRow["compiledReference"]>["helpers"];
  value: string;
}

type ApEnvCompiledReferenceHelper = NonNullable<
  ContainerEnvRow["compiledReference"]
>["helpers"][number];

export interface ApEnvRawSourceReferenceResolutionResult {
  diagnostics: ApEnvRawSourceDiagnostic[];
  references: ApEnvResolvedReferenceToken[];
  source: string;
  valid: boolean;
}

export interface ApEnvRawSourceRuntimeCompileResult {
  diagnostics: ApEnvRawSourceDiagnostic[];
  env: ContainerEnvRow[];
  envRawSource: string;
  valid: boolean;
}

export interface ApEnvReferenceMenuItem {
  available: boolean;
  dbName: string;
  description: string;
  expression: string;
  label: string;
  type: "Alias" | "Secret" | "Value";
  variableName: ApEnvReferenceVariableName;
}

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const DB_REFERENCE_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/i;
const AP_ENV_REFERENCE_SUGGESTION_QUERY_RE = /^[A-Za-z0-9_.-]*$/;
const AP_ENV_REFERENCE_RE =
  /\$\{\{([A-Za-z0-9](?:[-A-Za-z0-9]*[A-Za-z0-9])?)\.([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g;
const EDGE_WHITESPACE_RE = /^\s|\s$/;
const WHITESPACE_RE = /\s/;
const AP_ENV_REFERENCE_VARIABLES = [
  "DATABASE_URL",
  "PG_USER",
  "PG_PASSWORD",
  "PG_HOST",
  "PG_PORT",
] as const satisfies readonly ApEnvReferenceVariableName[];
const AP_ENV_REFERENCE_PRIMITIVE_VARIABLES: Record<
  Exclude<ApEnvReferenceVariableName, "DATABASE_URL">,
  ContainerEnvDbPrimitiveField
> = {
  PG_HOST: "host",
  PG_PASSWORD: "password",
  PG_PORT: "port",
  PG_USER: "username",
};
const AP_ENV_REFERENCE_DSN_FIELD_ORDER: readonly ContainerEnvDbPrimitiveField[] =
  ["username", "password", "host", "port"];

function splitSourceLines(source: string): string[] {
  const lines = source.split("\n");
  if (lines.length > 1 && lines.at(-1) === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

function leadingWhitespaceLength(value: string): number {
  return value.length - value.trimStart().length;
}

function trailingWhitespaceLength(value: string): number {
  return value.length - value.trimEnd().length;
}

function nextQuoteState(
  quote: "'" | '"' | null,
  char: string
): "'" | '"' | null {
  if (quote === char) {
    return null;
  }
  if (quote == null && (char === "'" || char === '"')) {
    return char;
  }
  return quote;
}

function commentIndex(value: string): number {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (escaped) {
      escaped = false;
    } else if (quote === '"' && char === "\\") {
      escaped = true;
    } else {
      quote = nextQuoteState(quote, char);
      if (
        quote == null &&
        char === "#" &&
        (index === 0 || WHITESPACE_RE.test(value[index - 1] ?? ""))
      ) {
        return index;
      }
    }
  }
  return -1;
}

function unescapeDoubleQuotedValue(value: string): string {
  return value.replaceAll(/\\([\\nrt"$#])/g, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return escaped;
    }
  });
}

function parseRawValue(rawValue: string): ParsedApEnvRawValue {
  if (rawValue.length >= 2) {
    const quote = rawValue[0];
    if ((quote === "'" || quote === '"') && rawValue.at(-1) === quote) {
      const inner = rawValue.slice(1, -1);
      return {
        quote,
        value: quote === '"' ? unescapeDoubleQuotedValue(inner) : inner,
      };
    }
  }
  return { quote: null, value: rawValue };
}

function parseAssignmentLine(
  raw: string,
  line: number
): ParsedApEnvRawAssignmentLine {
  const equalsIndex = raw.indexOf("=");
  if (equalsIndex === -1) {
    return {
      diagnostic: {
        line,
        message: "Expected KEY=VALUE.",
        type: "syntax",
      },
    };
  }

  const rawKey = raw.slice(0, equalsIndex);
  const keyStart = leadingWhitespaceLength(rawKey);
  const keyEnd = rawKey.length - trailingWhitespaceLength(rawKey);
  const key = raw.slice(keyStart, keyEnd);
  if (key === "") {
    return {
      diagnostic: {
        line,
        message: "Environment variable name is required.",
        type: "missing-name",
      },
    };
  }
  if (!ENV_KEY_RE.test(key)) {
    return {
      diagnostic: {
        key,
        line,
        message:
          "Use letters, digits, underscores, dots, or hyphens; do not start with a digit.",
        type: "invalid-name",
      },
    };
  }

  const valueWithComment = raw.slice(equalsIndex + 1);
  const inlineCommentIndex = commentIndex(valueWithComment);
  const valuePart =
    inlineCommentIndex === -1
      ? valueWithComment
      : valueWithComment.slice(0, inlineCommentIndex);
  const inlineComment =
    inlineCommentIndex === -1 ? "" : valueWithComment.slice(inlineCommentIndex);
  const valueStart = equalsIndex + 1 + leadingWhitespaceLength(valuePart);
  const valueEnd =
    equalsIndex + 1 + valuePart.length - trailingWhitespaceLength(valuePart);
  const rawValue = raw.slice(valueStart, valueEnd);
  const parsedValue = parseRawValue(rawValue);

  return {
    parsed: {
      equalsIndex,
      inlineComment,
      key,
      keyEnd,
      keyStart,
      kind: "assignment",
      line,
      quote: parsedValue.quote,
      raw,
      rawValue,
      value: parsedValue.value,
      valueEnd,
      valueStart,
    },
  };
}

export function parseApEnvRawSource(source: string): ApEnvRawSourceParseResult {
  const diagnostics: ApEnvRawSourceDiagnostic[] = [];
  const rows: ApEnvRawSourceAssignment[] = [];
  const lines: ApEnvRawSourceLine[] = [];
  const seenKeys = new Set<string>();

  splitSourceLines(source).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "") {
      lines.push({ kind: "blank", line, raw });
      return;
    }
    if (trimmed.startsWith("#")) {
      lines.push({ kind: "comment", line, raw });
      return;
    }

    const parsed = parseAssignmentLine(raw, line);
    if (parsed.parsed === undefined) {
      if (parsed.diagnostic !== undefined) {
        diagnostics.push(parsed.diagnostic);
      }
      lines.push({ kind: "invalid", line, raw });
      return;
    }

    if (seenKeys.has(parsed.parsed.key)) {
      diagnostics.push({
        key: parsed.parsed.key,
        line,
        message: "Environment variable names must be unique.",
        type: "duplicate-name",
      });
    } else {
      seenKeys.add(parsed.parsed.key);
    }
    lines.push(parsed.parsed);
    rows.push(parsed.parsed);
  });

  return {
    diagnostics,
    lines,
    rows,
    source,
    valid: diagnostics.length === 0,
  };
}

export function apEnvRawSourceReferenceSuggestionContext(
  rawLine: string,
  column: number
): ApEnvRawSourceReferenceSuggestionContext | undefined {
  const cursorIndex = Math.max(0, Math.min(rawLine.length, column - 1));
  const parsed = parseAssignmentLine(rawLine, 1).parsed;
  if (parsed === undefined) {
    return undefined;
  }
  if (cursorIndex < parsed.valueStart || cursorIndex > parsed.valueEnd) {
    return undefined;
  }

  const beforeCursor = rawLine.slice(parsed.valueStart, cursorIndex);
  const referenceStartInValue = beforeCursor.lastIndexOf("${{");
  if (referenceStartInValue === -1) {
    return undefined;
  }
  const referenceStart = parsed.valueStart + referenceStartInValue;
  const closedBeforeCursor = beforeCursor.lastIndexOf("}}");
  if (closedBeforeCursor > referenceStartInValue) {
    return undefined;
  }
  if (rawLine.indexOf("}}", referenceStart + 3) !== -1) {
    return undefined;
  }

  const query = rawLine.slice(referenceStart + 3, cursorIndex);
  if (!AP_ENV_REFERENCE_SUGGESTION_QUERY_RE.test(query)) {
    return undefined;
  }
  return {
    endColumn: cursorIndex + 1,
    query,
    startColumn: referenceStart + 1,
  };
}

function normalizeReferenceVariableName(
  name: string
): ApEnvReferenceVariableName | undefined {
  const normalized = name
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_");
  if (normalized === "DATABASE_URL") {
    return "DATABASE_URL";
  }
  if (
    normalized === "PGUSER" ||
    normalized === "POSTGRES_USER" ||
    normalized === "POSTGRES_USERNAME" ||
    normalized === "DATABASE_USER" ||
    normalized === "DATABASE_USERNAME"
  ) {
    return "PG_USER";
  }
  if (
    normalized === "PGPASSWORD" ||
    normalized === "POSTGRES_PASSWORD" ||
    normalized === "DATABASE_PASSWORD"
  ) {
    return "PG_PASSWORD";
  }
  if (
    normalized === "PGHOST" ||
    normalized === "POSTGRES_HOST" ||
    normalized === "DATABASE_HOST"
  ) {
    return "PG_HOST";
  }
  if (
    normalized === "PGPORT" ||
    normalized === "POSTGRES_PORT" ||
    normalized === "DATABASE_PORT"
  ) {
    return "PG_PORT";
  }
  return AP_ENV_REFERENCE_VARIABLES.find(
    (variableName) => variableName === normalized
  );
}

function sourceMatchesDbReferenceName(
  source: ContainerEnvDbDsnSource,
  name: string
): boolean {
  return source.name.toLowerCase() === name.toLowerCase();
}

function dbSourceByReferenceName(
  sources: readonly ContainerEnvDbDsnSource[],
  name: string
): ContainerEnvDbDsnSource | undefined {
  if (!DB_REFERENCE_NAME_RE.test(name)) {
    return undefined;
  }
  return sources.find((source) => sourceMatchesDbReferenceName(source, name));
}

function dbReferenceSourceKey(source: ContainerEnvDbDsnSource): string {
  return `${source.namespace}/${source.name}`;
}

function dbIdentityForHelper(source: ContainerEnvDbDsnSource): string {
  const identity = source.name
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return identity === "" ? "DB" : identity;
}

function helperFieldSuffix(
  field: ContainerEnvDbPrimitiveField | "databaseUrl"
): string {
  switch (field) {
    case "databaseUrl":
      return "DATABASE_URL";
    case "username":
      return "USERNAME";
    default:
      return field.toUpperCase();
  }
}

function referenceVariableOptions(
  source: ContainerEnvDbDsnSource
): ApEnvReferenceVariableOption[] {
  const options: ApEnvReferenceVariableOption[] = [
    { field: "databaseUrl", name: "DATABASE_URL", type: "alias" },
  ];
  for (const [name, field] of Object.entries(
    AP_ENV_REFERENCE_PRIMITIVE_VARIABLES
  ) as [
    Exclude<ApEnvReferenceVariableName, "DATABASE_URL">,
    ContainerEnvDbPrimitiveField,
  ][]) {
    const valueFrom = source.primitiveSecretRefs?.[field];
    if (valueFrom === undefined) {
      continue;
    }
    options.push({
      field,
      name,
      type: "secret",
      valueFrom: { secretKeyRef: valueFrom },
    });
  }
  for (const variable of source.variables ?? []) {
    const canonicalName = normalizeReferenceVariableName(variable.name);
    if (canonicalName === undefined) {
      continue;
    }
    const field = variable.field ?? referenceFieldForVariable(canonicalName);
    const valueFrom = variable.valueFrom;
    options.push({
      field,
      name: canonicalName,
      type: variable.type,
      ...(variable.value === undefined ? {} : { value: variable.value }),
      ...(valueFrom === undefined ? {} : { valueFrom }),
    });
  }
  return options;
}

function referenceFieldForVariable(
  variableName: ApEnvReferenceVariableName
): ContainerEnvDbPrimitiveField | "databaseUrl" {
  if (variableName === "DATABASE_URL") {
    return "databaseUrl";
  }
  return AP_ENV_REFERENCE_PRIMITIVE_VARIABLES[variableName];
}

function referenceVariableOption(
  source: ContainerEnvDbDsnSource,
  variableName: ApEnvReferenceVariableName
): ApEnvReferenceVariableOption | undefined {
  return referenceVariableOptions(source).find(
    (option) => option.name === variableName
  );
}

function referenceMenuItemType(
  option: ApEnvReferenceVariableOption | undefined
): ApEnvReferenceMenuItem["type"] {
  if (option?.type === "secret") {
    return "Secret";
  }
  if (option?.type === "value") {
    return "Value";
  }
  return "Alias";
}

function databaseUrlReferenceAvailable(
  source: ContainerEnvDbDsnSource
): boolean {
  return AP_ENV_REFERENCE_DSN_FIELD_ORDER.every(
    (field) => source.primitiveSecretRefs?.[field] !== undefined
  );
}

export function buildApEnvReferenceMenuItems(
  sources: readonly ContainerEnvDbDsnSource[]
): ApEnvReferenceMenuItem[] {
  const items: ApEnvReferenceMenuItem[] = [];
  for (const source of sources) {
    for (const variableName of AP_ENV_REFERENCE_VARIABLES) {
      const option = referenceVariableOption(source, variableName);
      const available =
        variableName === "DATABASE_URL"
          ? databaseUrlReferenceAvailable(source)
          : option !== undefined;
      items.push({
        available,
        dbName: source.name,
        description: available ? "Available" : "Unavailable",
        expression: `\${{${source.name}.${variableName}}}`,
        label: variableName,
        type: referenceMenuItemType(option),
        variableName,
      });
    }
  }
  return items;
}

function incompleteReferenceStart(value: string, cursor: number): number {
  const beforeCursor = value.slice(0, cursor);
  const start = beforeCursor.lastIndexOf("${{");
  if (start === -1) {
    return -1;
  }
  const closed = beforeCursor.lastIndexOf("}}");
  return closed > start ? -1 : start;
}

function incompleteReferenceEnd(value: string, _start: number, cursor: number) {
  const close = value.indexOf("}}", cursor);
  return close === -1 ? cursor : close + 2;
}

export function insertApEnvReferenceText(
  value: string,
  expression: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): string {
  const start = Math.max(
    0,
    Math.min(value.length, selectionStart ?? value.length)
  );
  const end = Math.max(start, Math.min(value.length, selectionEnd ?? start));
  const incompleteStart = incompleteReferenceStart(value, start);
  if (incompleteStart !== -1) {
    const incompleteEnd = incompleteReferenceEnd(value, incompleteStart, end);
    return `${value.slice(0, incompleteStart)}${expression}${value.slice(
      incompleteEnd
    )}`;
  }
  return `${value.slice(0, start)}${expression}${value.slice(end)}`;
}

function parseApEnvReferenceTokens(value: string): ApEnvReferenceToken[] {
  const tokens: ApEnvReferenceToken[] = [];
  for (const match of value.matchAll(AP_ENV_REFERENCE_RE)) {
    if (match.index === undefined) {
      continue;
    }
    const dbName = match[1];
    const variableName = match[2];
    if (dbName === undefined || variableName === undefined) {
      continue;
    }
    tokens.push({
      dbName,
      end: match.index + match[0].length,
      raw: match[0],
      start: match.index,
      variableName,
    });
  }
  return tokens;
}

function resolveApEnvReferenceToken(
  token: ApEnvReferenceToken,
  line: number,
  sources: readonly ContainerEnvDbDsnSource[]
): {
  diagnostic?: ApEnvRawSourceDiagnostic;
  reference?: ApEnvResolvedReferenceToken;
} {
  const source = dbSourceByReferenceName(sources, token.dbName);
  if (source === undefined) {
    return {
      diagnostic: {
        line,
        message: `DB Reference "${token.dbName}" was not found.`,
        type: "unresolved-reference",
      },
    };
  }

  const canonicalVariableName = normalizeReferenceVariableName(
    token.variableName
  );
  if (
    canonicalVariableName === undefined ||
    referenceVariableOption(source, canonicalVariableName) === undefined
  ) {
    return {
      diagnostic: {
        line,
        message: `DB Reference variable "${token.variableName}" is not available on ${source.name}.`,
        type: "unresolved-reference",
      },
    };
  }

  const canonicalRaw = `\${{${source.name}.${canonicalVariableName}}}`;
  return {
    reference: {
      ...token,
      canonicalDbName: source.name,
      canonicalRaw,
      canonicalVariableName,
      line,
      source,
    },
  };
}

function resolvedReferencesForValue(
  value: string,
  line: number,
  sources: readonly ContainerEnvDbDsnSource[]
): {
  diagnostics: ApEnvRawSourceDiagnostic[];
  references: ApEnvResolvedReferenceToken[];
} {
  const diagnostics: ApEnvRawSourceDiagnostic[] = [];
  const references: ApEnvResolvedReferenceToken[] = [];
  for (const token of parseApEnvReferenceTokens(value)) {
    const resolved = resolveApEnvReferenceToken(token, line, sources);
    if (resolved.diagnostic !== undefined) {
      diagnostics.push(resolved.diagnostic);
    }
    if (resolved.reference !== undefined) {
      references.push(resolved.reference);
    }
  }
  return { diagnostics, references };
}

function sourceWithCanonicalReferences(
  source: string,
  parsed: ApEnvRawSourceParseResult,
  references: readonly ApEnvResolvedReferenceToken[]
): string {
  if (references.length === 0) {
    return source;
  }
  const rowsByLine = new Map(parsed.rows.map((row) => [row.line, row]));
  const referencesByLine = new Map<number, ApEnvResolvedReferenceToken[]>();
  for (const reference of references) {
    const row = rowsByLine.get(reference.line);
    if (row === undefined) {
      continue;
    }
    const lineReferences = referencesByLine.get(row.line) ?? [];
    lineReferences.push(reference);
    referencesByLine.set(row.line, lineReferences);
  }

  const lines = splitSourceLines(source);
  for (const [line, lineReferences] of referencesByLine) {
    const raw = lines[line - 1];
    const row = rowsByLine.get(line);
    if (raw === undefined || row === undefined) {
      continue;
    }
    let nextValue = row.rawValue;
    for (const reference of lineReferences) {
      nextValue = nextValue.replaceAll(reference.raw, reference.canonicalRaw);
    }
    lines[line - 1] =
      raw.slice(0, row.valueStart) + nextValue + raw.slice(row.valueEnd);
  }
  return lines.join("\n");
}

export function resolveApEnvRawSourceReferences(
  source: string,
  sources: readonly ContainerEnvDbDsnSource[] = []
): ApEnvRawSourceReferenceResolutionResult {
  const parsed = parseApEnvRawSource(source);
  const diagnostics = [...parsed.diagnostics];
  const references: ApEnvResolvedReferenceToken[] = [];
  if (!parsed.valid) {
    return { diagnostics, references, source, valid: false };
  }

  for (const row of parsed.rows) {
    const resolved = resolvedReferencesForValue(row.value, row.line, sources);
    diagnostics.push(...resolved.diagnostics);
    references.push(...resolved.references);
  }

  return {
    diagnostics,
    references,
    source: sourceWithCanonicalReferences(source, parsed, references),
    valid: diagnostics.length === 0,
  };
}

function helperNameForDbField(
  source: ContainerEnvDbDsnSource,
  field: ContainerEnvDbPrimitiveField,
  context: ApEnvRuntimeCompileContext
): string {
  const sourceKey = dbReferenceSourceKey(source);
  const helperKey = `${sourceKey}:${field}`;
  const existing = context.helperNameByDbField.get(helperKey);
  if (existing !== undefined) {
    return existing;
  }

  const base = `${dbIdentityForHelper(source)}_${helperFieldSuffix(field)}`;
  let candidate = base;
  let suffix = 2;
  while (
    context.explicitNames.has(candidate) ||
    context.helperNames.has(candidate)
  ) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  context.helperNameByDbField.set(helperKey, candidate);
  context.helperNames.add(candidate);
  return candidate;
}

function helperRowForDbField(
  source: ContainerEnvDbDsnSource,
  field: ContainerEnvDbPrimitiveField,
  line: number,
  context: ApEnvRuntimeCompileContext
): ContainerEnvRow | undefined {
  const sourceKey = dbReferenceSourceKey(source);
  const helperKey = `${sourceKey}:${field}`;
  const existing = context.helperByDbField.get(helperKey);
  if (existing !== undefined) {
    return existing;
  }

  const secretKeyRef = source.primitiveSecretRefs?.[field];
  if (secretKeyRef === undefined) {
    context.diagnostics.push({
      line,
      message: `DB Reference variable "${helperFieldSuffix(field)}" is not available on ${source.name}.`,
      type: "runtime-compile",
    });
    return undefined;
  }

  const row: ContainerEnvRow = {
    dbDsn: {
      dbName: source.name,
      dbNamespace: source.namespace,
      field,
    },
    helper: {
      automatic: true,
      sourceDbKey: sourceKey,
      sourceField: field,
    },
    name: helperNameForDbField(source, field, context),
    value: CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
    valueFrom: { secretKeyRef },
    valueSource: "valueFrom",
  };
  context.helperByDbField.set(helperKey, row);
  return row;
}

function compiledReferenceHelperForDbField(
  field: ContainerEnvDbPrimitiveField,
  helper: ContainerEnvRow
): ApEnvCompiledReferenceHelper {
  return {
    field,
    name: helper.name,
    valueFrom:
      helper.valueFrom == null
        ? undefined
        : (helper.valueFrom as { secretKeyRef: ContainerEnvSecretKeyRef }),
  };
}

function dbDsnScheme(source: ContainerEnvDbDsnSource): string {
  const engine = source.engine?.trim().toLowerCase() ?? "";
  if (engine.includes("mysql")) {
    return "mysql";
  }
  if (engine.includes("mongo")) {
    return "mongodb";
  }
  if (engine.includes("redis")) {
    return "redis";
  }
  return "postgresql";
}

function compileDatabaseUrlReference(
  reference: ApEnvResolvedReferenceToken,
  line: number,
  context: ApEnvRuntimeCompileContext
): ApEnvReferenceCompileResult {
  const helpers: ContainerEnvRow[] = [];
  const helpersUsed: NonNullable<
    ContainerEnvRow["compiledReference"]
  >["helpers"] = [];
  const helperNames: Partial<Record<ContainerEnvDbPrimitiveField, string>> = {};

  for (const field of AP_ENV_REFERENCE_DSN_FIELD_ORDER) {
    const helper = helperRowForDbField(reference.source, field, line, context);
    if (helper === undefined) {
      continue;
    }
    helpers.push(helper);
    helperNames[field] = helper.name;
    helpersUsed.push(compiledReferenceHelperForDbField(field, helper));
  }

  if (
    helperNames.username === undefined ||
    helperNames.password === undefined ||
    helperNames.host === undefined ||
    helperNames.port === undefined
  ) {
    return { helpers, helpersUsed, value: reference.canonicalRaw };
  }

  return {
    helpers,
    helpersUsed,
    value: `${dbDsnScheme(reference.source)}://$(${helperNames.username}):$(${helperNames.password})@$(${helperNames.host}):$(${helperNames.port})`,
  };
}

function compilePrimitiveReference(
  reference: ApEnvResolvedReferenceToken,
  line: number,
  context: ApEnvRuntimeCompileContext
): ApEnvReferenceCompileResult {
  if (reference.canonicalVariableName === "DATABASE_URL") {
    return compileDatabaseUrlReference(reference, line, context);
  }
  const field = referenceFieldForVariable(reference.canonicalVariableName);
  if (field === "databaseUrl") {
    return compileDatabaseUrlReference(reference, line, context);
  }
  const helper = helperRowForDbField(reference.source, field, line, context);
  return {
    helpers: helper === undefined ? [] : [helper],
    helpersUsed:
      helper === undefined
        ? []
        : [compiledReferenceHelperForDbField(field, helper)],
    value: helper === undefined ? reference.canonicalRaw : `$(${helper.name})`,
  };
}

function compileRowReferences(
  row: ApEnvRawSourceAssignment,
  references: readonly ApEnvResolvedReferenceToken[],
  context: ApEnvRuntimeCompileContext
): {
  helpers: ContainerEnvRow[];
  row: ContainerEnvRow;
} {
  if (references.length === 0) {
    return { helpers: [], row: { name: row.key, value: row.value } };
  }

  let value = row.value;
  const helperByName = new Map<string, ContainerEnvRow>();
  const helpersUsedByName = new Map<
    string,
    NonNullable<ContainerEnvRow["compiledReference"]>["helpers"][number]
  >();
  for (const reference of references) {
    const compiled = compilePrimitiveReference(reference, row.line, context);
    value = value
      .replaceAll(reference.raw, compiled.value)
      .replaceAll(reference.canonicalRaw, compiled.value);
    for (const helper of compiled.helpers) {
      helperByName.set(helper.name, helper);
    }
    for (const helper of compiled.helpersUsed) {
      helpersUsedByName.set(helper.name, helper);
    }
  }

  return {
    helpers: Array.from(helperByName.values()),
    row: {
      compiledReference: {
        expression: references
          .map((reference) => reference.canonicalRaw)
          .join(", "),
        helpers: Array.from(helpersUsedByName.values()),
      },
      name: row.key,
      value,
    },
  };
}

function referencesByRow(
  parsed: ApEnvRawSourceParseResult,
  references: readonly ApEnvResolvedReferenceToken[]
): Map<number, ApEnvResolvedReferenceToken[]> {
  const out = new Map<number, ApEnvResolvedReferenceToken[]>();
  const rowLines = new Set(parsed.rows.map((row) => row.line));
  for (const reference of references) {
    if (!rowLines.has(reference.line)) {
      continue;
    }
    const rowReferences = out.get(reference.line) ?? [];
    rowReferences.push(reference);
    out.set(reference.line, rowReferences);
  }
  return out;
}

export function compileApEnvRawSourceForRuntime(
  source: string,
  sources: readonly ContainerEnvDbDsnSource[] = []
): ApEnvRawSourceRuntimeCompileResult {
  const resolution = resolveApEnvRawSourceReferences(source, sources);
  const parsed = parseApEnvRawSource(resolution.source);
  const diagnostics = [...resolution.diagnostics];
  if (!(resolution.valid && parsed.valid)) {
    return {
      diagnostics,
      env: [],
      envRawSource: resolution.source,
      valid: false,
    };
  }

  const explicitNames = new Set(parsed.rows.map((row) => row.key));
  const context: ApEnvRuntimeCompileContext = {
    diagnostics,
    explicitNames,
    helperByDbField: new Map(),
    helperNameByDbField: new Map(),
    helperNames: new Set(),
  };
  const references = referencesByRow(parsed, resolution.references);
  const env: ContainerEnvRow[] = [];
  const helperByName = new Map<string, ContainerEnvRow>();
  for (const row of parsed.rows) {
    const compiled = compileRowReferences(
      row,
      references.get(row.line) ?? [],
      context
    );
    env.push(compiled.row);
    for (const helper of compiled.helpers) {
      helperByName.set(helper.name, helper);
    }
  }
  env.push(...helperByName.values());

  return {
    diagnostics,
    env,
    envRawSource: resolution.source,
    valid: diagnostics.length === 0,
  };
}

function escapeDoubleQuotedValue(value: string): string {
  return value.replaceAll(/[\\\n\r\t"$]/g, (char) => {
    switch (char) {
      case "\\":
        return "\\\\";
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      case '"':
        return '\\"';
      case "$":
        return "\\$";
      default:
        return char;
    }
  });
}

function valueForExistingRawFormatting(
  value: string,
  row: ApEnvRawSourceAssignment
): string {
  if (row.quote === "'") {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }
  if (row.quote === '"') {
    return `"${escapeDoubleQuotedValue(value)}"`;
  }
  return value;
}

function rawValueForNewAssignment(value: string): string {
  if (EDGE_WHITESPACE_RE.test(value) || value.includes("\n")) {
    return `"${escapeDoubleQuotedValue(value)}"`;
  }
  return value;
}

export function apEnvRawAssignmentsToRows(
  rows: readonly ApEnvRawSourceAssignment[]
): ContainerEnvRow[] {
  return rows.map((row) => ({
    name: row.key,
    value: row.value,
  }));
}

export function apEnvRawSourceRows(source: string): ContainerEnvRow[] {
  return apEnvRawAssignmentsToRows(parseApEnvRawSource(source).rows);
}

export function apEnvRawSourceFromRows(
  rows: readonly Pick<ContainerEnvRow, "name" | "value" | "valueFrom">[]
): string {
  return rows
    .flatMap((row) => {
      const name = row.name.trim();
      if (name === "" || row.valueFrom != null) {
        return [];
      }
      return `${name}=${rawValueForNewAssignment(row.value)}`;
    })
    .join("\n");
}

export function canonicalApEnvRawSource({
  env,
  envRawSource,
}: {
  env: readonly Pick<ContainerEnvRow, "name" | "value" | "valueFrom">[];
  envRawSource?: string;
}): string {
  return envRawSource == null ? apEnvRawSourceFromRows(env) : envRawSource;
}

export function applyApEnvRawSourceRowPatch(
  source: string,
  rowIndex: number,
  patch: Partial<Pick<ContainerEnvRow, "name" | "value">>
): ApEnvRawSourceParseResult {
  const parsed = parseApEnvRawSource(source);
  const target = parsed.rows[rowIndex];
  if (target === undefined) {
    return parsed;
  }

  const lines = splitSourceLines(source);
  const raw = lines[target.line - 1] ?? target.raw;
  const nextName = patch.name ?? target.key;
  const nextValue =
    patch.value === undefined
      ? target.rawValue
      : valueForExistingRawFormatting(patch.value, target);
  const keyPrefix = raw.slice(0, target.keyStart);
  const betweenKeyAndValue = raw.slice(target.keyEnd, target.valueStart);
  const suffix = raw.slice(target.valueEnd);
  lines[target.line - 1] =
    `${keyPrefix}${nextName}${betweenKeyAndValue}${nextValue}${suffix}`;
  return parseApEnvRawSource(lines.join("\n"));
}

export function appendApEnvRawSourceRow(
  source: string,
  row: Pick<ContainerEnvRow, "name" | "value">
): ApEnvRawSourceParseResult {
  const assignment = `${row.name.trim()}=${rawValueForNewAssignment(row.value)}`;
  const nextSource = source === "" ? assignment : `${source}\n${assignment}`;
  return parseApEnvRawSource(nextSource);
}

export function deleteApEnvRawSourceRow(
  source: string,
  rowIndex: number
): ApEnvRawSourceParseResult {
  const parsed = parseApEnvRawSource(source);
  const target = parsed.rows[rowIndex];
  if (target === undefined) {
    return parsed;
  }
  const lines = splitSourceLines(source);
  lines.splice(target.line - 1, 1);
  return parseApEnvRawSource(lines.join("\n"));
}

export function normalizeApEnvRawSourceForSave(source: string): {
  diagnostics: ApEnvRawSourceDiagnostic[];
  env: ContainerEnvRow[];
  envRawSource: string;
  valid: boolean;
} {
  const parsed = parseApEnvRawSource(source);
  if (!parsed.valid) {
    return {
      diagnostics: parsed.diagnostics,
      env: [],
      envRawSource: source,
      valid: false,
    };
  }
  return {
    diagnostics: [],
    env: apEnvRawAssignmentsToRows(parsed.rows),
    envRawSource: source,
    valid: true,
  };
}
