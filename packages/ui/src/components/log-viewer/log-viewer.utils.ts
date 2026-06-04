export const STANDARD_LOG_LEVELS = [
  "TRACE",
  "DEBUG",
  "INFO",
  "WARN",
  "ERROR",
  "FATAL",
] as const;

export type StandardLogLevel = (typeof STANDARD_LOG_LEVELS)[number];

const LOG_LEVEL_ALIASES: Record<string, StandardLogLevel> = {
  CRIT: "FATAL",
  CRITICAL: "FATAL",
  DEBUG: "DEBUG",
  ERROR: "ERROR",
  ERR: "ERROR",
  FATAL: "FATAL",
  INFO: "INFO",
  INFORMATION: "INFO",
  LOG: "INFO",
  NOTICE: "INFO",
  PANIC: "FATAL",
  TRACE: "TRACE",
  TRC: "TRACE",
  WARN: "WARN",
  WARNING: "WARN",
};

const LEADING_LEVEL_RE =
  /^(?<leading>\s*)(?:\[(?<bracket>[A-Za-z][A-Za-z0-9_-]*)\]|(?<bare>[A-Za-z][A-Za-z0-9_-]*))(?:[:\]\s-]+|$)/;
const LEADING_LEVEL_KEY_VALUE_RE =
  /^(?<leading>\s*)(?<key>level|severity)=["']?(?<value>[A-Za-z][A-Za-z0-9_-]*)["']?(?:[:\s,]+|$)/i;
const JSON_LEVEL_RE =
  /"(?:level|severity)"\s*:\s*"(?<value>[A-Za-z][A-Za-z0-9_-]*)"/i;
const INLINE_LEVEL_KEY_VALUE_RE =
  /(?:^|\s)(?:level|severity)=["']?(?<value>[A-Za-z][A-Za-z0-9_-]*)["']?(?:\s|,|$)/i;
const KLOG_PREFIX_RE = /^(?<level>[IWEF])\d{4}\s/;
const POSTGRES_DEBUG_LEVEL_RE = /^DEBUG[1-5]$/;
const LEADING_TIMESTAMP_RES = [
  /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\s+/,
  /^\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\s+[A-Z]{2,5}(?:\s+\[\d+\])?\s+/,
];

const KLOG_LEVELS: Record<string, StandardLogLevel> = {
  E: "ERROR",
  F: "FATAL",
  I: "INFO",
  W: "WARN",
};

export interface LeadingLogLevel {
  endIndex: number;
  level: StandardLogLevel;
  token: string;
}

export function normalizeLogLevel(
  value: string | undefined
): StandardLogLevel | null {
  const token =
    value
      ?.trim()
      .replace(/[:\]]+$/g, "")
      .toUpperCase() ?? "";
  if (token === "") {
    return null;
  }
  if (POSTGRES_DEBUG_LEVEL_RE.test(token)) {
    return "DEBUG";
  }
  return LOG_LEVEL_ALIASES[token] ?? null;
}

export function parseLeadingLogLevel(message: string): LeadingLogLevel | null {
  const keyValueMatch = message.match(LEADING_LEVEL_KEY_VALUE_RE);
  if (keyValueMatch?.groups?.value) {
    const level = normalizeLogLevel(keyValueMatch.groups.value);
    if (level) {
      return {
        endIndex: keyValueMatch[0].length,
        level,
        token: keyValueMatch.groups.value,
      };
    }
  }

  const levelMatch = message.match(LEADING_LEVEL_RE);
  const token = levelMatch?.groups?.bracket ?? levelMatch?.groups?.bare;
  const level = normalizeLogLevel(token);
  if (!(levelMatch && token && level)) {
    return null;
  }
  return {
    endIndex: levelMatch[0].length,
    level,
    token,
  };
}

function stripLeadingTimestampWhenLevelFollows(message: string): string {
  for (const re of LEADING_TIMESTAMP_RES) {
    const match = message.match(re);
    if (!match) {
      continue;
    }
    const rest = message.slice(match[0].length);
    if (parseLeadingLogLevel(rest)) {
      return rest;
    }
  }
  return message;
}

export function formatLogMessage(message: string): string {
  return stripLeadingTimestampWhenLevelFollows(message);
}

export function getLogLevel(message: string): StandardLogLevel | null {
  const formatted = formatLogMessage(message).trimStart();
  const leadingLevel = parseLeadingLogLevel(formatted);
  if (leadingLevel) {
    return leadingLevel.level;
  }

  const klogMatch = formatted.match(KLOG_PREFIX_RE);
  if (klogMatch?.groups?.level) {
    return KLOG_LEVELS[klogMatch.groups.level] ?? null;
  }

  const jsonLevel = JSON_LEVEL_RE.exec(formatted)?.groups?.value;
  const jsonNormalized = normalizeLogLevel(jsonLevel);
  if (jsonNormalized) {
    return jsonNormalized;
  }

  const inlineLevel = INLINE_LEVEL_KEY_VALUE_RE.exec(formatted)?.groups?.value;
  return normalizeLogLevel(inlineLevel);
}

export function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${y}/${mo}/${da} ${h}:${mi}:${s}`;
  } catch {
    return iso;
  }
}
