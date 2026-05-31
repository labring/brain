import type { ReactNode } from "react";

const LOG_LEVEL_RE = /^(?:ERROR|WARN|INFO|DEBUG):?\s/;

const LEVEL_CLASS: Record<string, string> = {
  ERROR: "text-red-500 font-semibold",
  WARN: "text-amber-500 font-semibold",
  INFO: "text-blue-500 font-semibold",
  DEBUG: "text-zinc-400",
};

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
  const levelMatch = msg.match(LOG_LEVEL_RE);

  if (!(levelMatch || q)) {
    return msg;
  }

  if (levelMatch) {
    const prefix = levelMatch[0];
    const lvl = prefix.replace(/[:\s]/g, "");
    const cls = LEVEL_CLASS[lvl];
    const rest = msg.slice(prefix.length);
    return (
      <>
        {renderPrefix(cls, prefix, q)}
        {q ? wrapSearch(rest, q, "r") : rest}
      </>
    );
  }

  return wrapSearch(msg, q, "s");
}
