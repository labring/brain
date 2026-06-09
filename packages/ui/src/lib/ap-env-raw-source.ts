import type { ContainerEnvRow } from "./container-env-rows";

export type ApEnvRawSourceDiagnosticType =
  | "duplicate-name"
  | "invalid-name"
  | "missing-name"
  | "syntax";

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

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const EDGE_WHITESPACE_RE = /^\s|\s$/;
const WHITESPACE_RE = /\s/;

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

function parseRawValue(rawValue: string): {
  quote: "'" | '"' | null;
  value: string;
} {
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
): {
  diagnostic?: ApEnvRawSourceDiagnostic;
  parsed?: ApEnvRawSourceAssignmentLine;
} {
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
  const firstLineByKey = new Map<string, number>();

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

    const firstLine = firstLineByKey.get(parsed.parsed.key);
    if (firstLine === undefined) {
      firstLineByKey.set(parsed.parsed.key, line);
    } else {
      diagnostics.push({
        key: parsed.parsed.key,
        line,
        message: "Environment variable names must be unique.",
        type: "duplicate-name",
      });
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
  if (value === "" || EDGE_WHITESPACE_RE.test(value) || value.includes("\n")) {
    return `"${escapeDoubleQuotedValue(value)}"`;
  }
  return value;
}

export function apEnvRawSourceRows(source: string): ContainerEnvRow[] {
  return parseApEnvRawSource(source).rows.map((row) => ({
    name: row.key,
    value: row.value,
  }));
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
    env: apEnvRawSourceRows(source),
    envRawSource: source,
    valid: true,
  };
}
