"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import {
  List,
  type RowComponentProps,
  useDynamicRowHeight,
} from "react-window";
import { type LogEntry, useLogViewerContext } from "./log-viewer.context";
import { highlightLogMessage } from "./log-viewer.highlight";
import { formatLogTime } from "./log-viewer.utils";

const LOG_GRID_TEMPLATE = "150px 1fr 80px 80px";

export function LogViewerListHeader() {
  return (
    <div
      className="flex flex-col border-b bg-muted-foreground/5"
      data-slot="log-viewer-header"
    >
      <div
        className="grid h-10 items-center gap-2 px-4 font-medium font-mono text-foreground text-xs"
        style={{ gridTemplateColumns: LOG_GRID_TEMPLATE }}
      >
        <span>Time</span>
        <span>Message</span>
        <span>Pod</span>
        <span>Container</span>
      </div>
    </div>
  );
}

function LogViewerRow({
  index,
  style,
  entries,
  searchQuery,
}: RowComponentProps<{ entries: LogEntry[]; searchQuery: string }>) {
  const entry = entries[index];
  if (!entry) {
    return null;
  }

  return (
    <div
      className={cn(
        "grid items-start gap-2 px-4 py-2 font-mono text-foreground text-xs",
        entry.stream === "stderr" && "border-red-500/40 border-l-2"
      )}
      style={{ ...style, gridTemplateColumns: LOG_GRID_TEMPLATE }}
    >
      <span className="truncate text-muted-foreground">
        {formatLogTime(entry.time)}
      </span>
      <span className="line-clamp-3 whitespace-pre-wrap break-all">
        {highlightLogMessage(entry.message, searchQuery)}
      </span>
      <span className="truncate text-muted-foreground">{entry.pod}</span>
      <span className="truncate text-muted-foreground">{entry.container}</span>
    </div>
  );
}

/** `useDynamicRowHeight` uses ResizeObserver — only mount after hydration (SSR-safe). */
function VirtualizedListClient({
  entries,
  searchQuery,
}: {
  entries: LogEntry[];
  searchQuery: string;
}) {
  const rowHeight = useDynamicRowHeight({ defaultRowHeight: 28 });

  return (
    <List
      rowComponent={LogViewerRow}
      rowCount={entries.length}
      rowHeight={rowHeight}
      rowProps={{ entries, searchQuery }}
    />
  );
}

function VirtualizedList({
  entries,
  searchQuery,
}: {
  entries: LogEntry[];
  searchQuery: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div aria-busy="true" className="h-full min-h-0 w-full" />;
  }

  return <VirtualizedListClient entries={entries} searchQuery={searchQuery} />;
}

export function LogViewerListContent() {
  const { entries, filteredEntries, searchQuery } = useLogViewerContext();

  if (entries.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-muted/50 p-6 text-muted-foreground"
        data-slot="log-viewer-empty"
      >
        No logs available.
      </div>
    );
  }

  if (filteredEntries.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-muted/50 p-6 text-muted-foreground"
        data-slot="log-viewer-empty"
      >
        No matching logs.
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-muted/50 py-2"
      data-slot="log-viewer-content"
    >
      <VirtualizedList entries={filteredEntries} searchQuery={searchQuery} />
    </div>
  );
}
