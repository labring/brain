"use client";

import { useEffect, useState } from "react";
import { List, type RowComponentProps } from "react-window";
import { type LogEntry, useLogViewerContext } from "./log-viewer.context";
import { highlightLogMessage } from "./log-viewer.highlight";
import { formatLogMessage, formatLogTime } from "./log-viewer.utils";

const LOG_GRID_TEMPLATE =
  "minmax(12rem,20%) minmax(0,1fr) minmax(6.25rem,10%) minmax(7rem,12%)";
const LOG_ROW_HEIGHT = 52;

export function LogViewerListHeader() {
  return (
    <div
      className="flex h-12 shrink-0 flex-col border-border border-b bg-input/30"
      data-slot="log-viewer-header"
    >
      <div
        className="grid h-full items-center font-medium text-muted-foreground text-xs"
        style={{ gridTemplateColumns: LOG_GRID_TEMPLATE }}
      >
        <span className="truncate px-4">Time</span>
        <span className="truncate px-4">Message</span>
        <span className="truncate px-4">Pod</span>
        <span className="truncate px-4">Container</span>
      </div>
    </div>
  );
}

function LogViewerRow({
  index,
  style,
  ariaAttributes,
  entries,
  searchQuery,
}: RowComponentProps<{ entries: LogEntry[]; searchQuery: string }>) {
  const entry = entries[index];
  if (!entry) {
    return null;
  }
  const message = formatLogMessage(entry.message);

  return (
    <div
      {...ariaAttributes}
      className="grid items-center border-border border-b font-medium text-foreground text-xs"
      style={{ ...style, gridTemplateColumns: LOG_GRID_TEMPLATE }}
    >
      <span className="truncate px-4">{formatLogTime(entry.time)}</span>
      <span className="block min-w-0 truncate px-4">
        {highlightLogMessage(message, searchQuery)}
      </span>
      <span className="truncate px-4">{entry.pod}</span>
      <span className="truncate px-4">{entry.container}</span>
    </div>
  );
}

function VirtualizedListClient({
  entries,
  searchQuery,
}: {
  entries: LogEntry[];
  searchQuery: string;
}) {
  return (
    <List
      rowComponent={LogViewerRow}
      rowCount={entries.length}
      rowHeight={LOG_ROW_HEIGHT}
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
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-background p-6 text-muted-foreground text-sm"
        data-slot="log-viewer-empty"
      >
        No logs available.
      </div>
    );
  }

  if (filteredEntries.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center bg-background p-6 text-muted-foreground text-sm"
        data-slot="log-viewer-empty"
      >
        No matching logs.
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden bg-background"
      data-slot="log-viewer-content"
    >
      <VirtualizedList entries={filteredEntries} searchQuery={searchQuery} />
    </div>
  );
}
