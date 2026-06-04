import type { ReactNode } from "react";
import {
  parseLeadingLogLevel,
  type StandardLogLevel,
} from "./log-viewer.utils";

const LEVEL_CLASS: Record<StandardLogLevel, string> = {
  DEBUG: "text-zinc-400",
  ERROR: "text-red-500 font-semibold",
  FATAL: "text-red-600 font-semibold",
  WARN: "text-amber-500 font-semibold",
  INFO: "text-blue-400 font-semibold",
  TRACE: "text-zinc-500",
};

export function logLevelClassName(level: StandardLogLevel): string {
  return LEVEL_CLASS[level];
}

export function highlightLogText(msg: string, searchQuery?: string): ReactNode {
  const q =
    searchQuery && searchQuery.length >= 2 ? searchQuery.toLowerCase() : "";
  return q ? wrapSearch(msg, q, "s") : msg;
}

function wrapSearch(text: string, q: string, key: string): ReactNode {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  let i = idx;
  let k = 0;
  while (i !== -1) {
    if (i > cursor) {
      parts.push(text.slice(cursor, i));
    }
    parts.push(
      <mark
        className="rounded-sm bg-amber-500/30 text-inherit"
        key={`${key}-${k++}`}
      >
        {text.slice(i, i + q.length)}
      </mark>
    );
    cursor = i + q.length;
    i = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.length === 1 ? parts[0] : parts;
}

function renderPrefix(
  cls: string | undefined,
  prefix: string,
  q: string
): ReactNode {
  const content = q ? wrapSearch(prefix, q, "lv") : prefix;
  if (cls) {
    return <span className={cls}>{content}</span>;
  }
  return content;
}

export function highlightLogMessage(
  msg: string,
  searchQuery?: string
): ReactNode {
  if (!msg) {
    return msg;
  }

  const q =
    searchQuery && searchQuery.length >= 2 ? searchQuery.toLowerCase() : "";
  const levelMatch = parseLeadingLogLevel(msg);

  if (!(levelMatch || q)) {
    return msg;
  }

  if (levelMatch) {
    const prefix = msg.slice(0, levelMatch.endIndex);
    const cls = logLevelClassName(levelMatch.level);
    const rest = msg.slice(levelMatch.endIndex);
    return (
      <>
        {renderPrefix(cls, prefix, q)}
        {q ? wrapSearch(rest, q, "r") : rest}
      </>
    );
  }

  return highlightLogText(msg, searchQuery);
}
