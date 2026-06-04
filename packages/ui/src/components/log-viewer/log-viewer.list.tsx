"use client";

import { useEffect, useMemo, useState } from "react";
import {
  List,
  type RowComponentProps,
  useDynamicRowHeight,
} from "react-window";
import { type LogEntry, useLogViewerContext } from "./log-viewer.context";
import { highlightLogMessage } from "./log-viewer.highlight";
import { formatLogMessage, formatLogTime } from "./log-viewer.utils";

const LOG_GRID_TEMPLATE =
  "minmax(12rem,20%) minmax(0,1fr) minmax(6.25rem,10%) minmax(7rem,12%)";
const LOG_ROW_MIN_HEIGHT = 52;

export function LogViewerListHeader() {
  return (
    <div
      className="flex h-12 shrink-0 flex-col border-border border-b bg-input/30"
      data-slot="log-viewer-header"
    >
      <div
        className="grid h-full items-center bg-input/30 font-medium text-muted-foreground text-xs"
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
      className="grid min-h-[52px] items-start border-border border-b bg-transparent py-3 font-medium text-foreground text-xs"
      style={{ ...style, gridTemplateColumns: LOG_GRID_TEMPLATE }}
    >
      <span className="truncate px-4 leading-5">
        {formatLogTime(entry.time)}
      </span>
      <span className="block min-w-0 whitespace-pre-wrap break-words px-4 leading-5">
        {highlightLogMessage(message, searchQuery)}
      </span>
      <span className="truncate px-4 leading-5">{entry.pod}</span>
      <span className="truncate px-4 leading-5">{entry.container}</span>
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
  const rowHeightKey = useMemo(
    () =>
      entries.map((entry) => `${entry.time}:${entry.message.length}`).join("|"),
    [entries]
  );
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: LOG_ROW_MIN_HEIGHT,
    key: rowHeightKey,
  });

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
        className="flex h-full min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground text-sm"
        data-slot="log-viewer-empty"
      >
        No logs available.
      </div>
    );
  }

  if (filteredEntries.length === 0) {
    return (
      <div
        className="flex h-full min-h-0 flex-1 items-center justify-center p-6 text-muted-foreground text-sm"
        data-slot="log-viewer-empty"
      >
        No matching logs.
      </div>
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 overflow-hidden"
      data-slot="log-viewer-content"
    >
      <VirtualizedList entries={filteredEntries} searchQuery={searchQuery} />
    </div>
  );
}
