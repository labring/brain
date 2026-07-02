"use client";

import {
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  List,
  type ListImperativeAPI,
  type RowComponentProps,
  useDynamicRowHeight,
} from "react-window";
import { type LogEntry, useLogViewerContext } from "./log-viewer.context";
import { highlightLogText, logLevelClassName } from "./log-viewer.highlight";
import {
  formatLogMessage,
  formatLogTime,
  parseLeadingLogLevel,
} from "./log-viewer.utils";

const LOG_GRID_TEMPLATE =
  "minmax(12rem,20%) minmax(0,1fr) minmax(6.25rem,10%) minmax(7rem,12%)";
const LOG_TABLE_MIN_WIDTH = 900;
const LOG_ROW_MIN_HEIGHT = 52;
const LOG_LEVEL_SLOT_WIDTH = "3.5rem";

export function LogViewerListHeader() {
  return (
    <div
      className="flex h-12 shrink-0 flex-col border-border border-b bg-input/30"
      data-slot="log-viewer-header"
    >
      <div
        className="grid h-full items-center bg-input/30 font-medium text-muted-foreground text-xs"
        style={{
          gridTemplateColumns: LOG_GRID_TEMPLATE,
          minWidth: LOG_TABLE_MIN_WIDTH,
        }}
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
  const level = parseLeadingLogLevel(message);
  const levelText = level ? `${level.level}:` : "";
  const bodyText = level ? message.slice(level.endIndex) : message;

  return (
    <div
      {...ariaAttributes}
      className="grid min-h-[52px] items-start border-border border-b bg-transparent py-3 font-medium text-foreground text-xs"
      style={{
        ...style,
        gridTemplateColumns: LOG_GRID_TEMPLATE,
        minWidth: LOG_TABLE_MIN_WIDTH,
      }}
    >
      <span className="truncate px-4 leading-5">
        {formatLogTime(entry.time)}
      </span>
      <span className="grid min-w-0 px-4 leading-5">
        <span
          className="grid min-w-0 items-start"
          style={{
            gridTemplateColumns: `${LOG_LEVEL_SLOT_WIDTH} minmax(0, 1fr)`,
          }}
        >
          <span
            className="block truncate pr-2"
            style={{ width: LOG_LEVEL_SLOT_WIDTH }}
          >
            {level ? (
              <span className={logLevelClassName(level.level)}>
                {levelText}
              </span>
            ) : null}
          </span>
          <span className="block min-w-0 whitespace-pre-wrap break-words font-medium">
            {highlightLogText(bodyText, searchQuery)}
          </span>
        </span>
      </span>
      <span className="truncate px-4 leading-5">{entry.pod}</span>
      <span className="truncate px-4 leading-5">{entry.container}</span>
    </div>
  );
}

const AT_BOTTOM_EPSILON_PX = 4;

function VirtualizedListClient({
  entries,
  searchQuery,
  isLive,
  onUserScrollAway,
}: {
  entries: LogEntry[];
  searchQuery: string;
  isLive: boolean;
  onUserScrollAway: () => void;
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
  const listRef = useRef<ListImperativeAPI>(null);
  const lastScrollTopRef = useRef(0);

  const pinToTail = useCallback(() => {
    const el = listRef.current?.element;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Live keeps the list pinned to the tail. Row rendering and measurement
  // happen inside List without re-rendering this component, so pin from both
  // this render effect and onRowsRendered; repeated assignments converge and
  // an unchanged scrollTop is a no-op.
  useEffect(() => {
    if (isLive) {
      pinToTail();
    }
  });

  function handleRowsRendered() {
    if (isLive) {
      pinToTail();
    }
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = el.scrollTop;
    if (!isLive) {
      return;
    }
    // Only the user scrolls upward: content growth never lowers scrollTop and
    // the pin effect only raises it. Scrolling away from the tail is a pause
    // gesture (ADR 0034).
    const atBottom =
      el.scrollTop + el.clientHeight >= el.scrollHeight - AT_BOTTOM_EPSILON_PX;
    if (el.scrollTop < previousTop - 1 && !atBottom) {
      onUserScrollAway();
    }
  }

  return (
    <List
      className="min-w-full"
      listRef={listRef}
      onRowsRendered={handleRowsRendered}
      onScroll={handleScroll}
      rowComponent={LogViewerRow}
      rowCount={entries.length}
      rowHeight={rowHeight}
      rowProps={{ entries, searchQuery }}
      style={{ minWidth: LOG_TABLE_MIN_WIDTH }}
    />
  );
}

function VirtualizedList({
  entries,
  searchQuery,
  isLive,
  onUserScrollAway,
}: {
  entries: LogEntry[];
  searchQuery: string;
  isLive: boolean;
  onUserScrollAway: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div aria-busy="true" className="h-full min-h-0 w-full" />;
  }

  return (
    <VirtualizedListClient
      entries={entries}
      isLive={isLive}
      onUserScrollAway={onUserScrollAway}
      searchQuery={searchQuery}
    />
  );
}

export function LogViewerListContent() {
  const {
    entries,
    filteredEntries,
    freeze,
    logWindow,
    searchQuery,
    truncatedAt,
  } = useLogViewerContext();

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
    <>
      {truncatedAt === undefined ? null : (
        <div
          className="shrink-0 border-border border-b bg-input/20 px-4 py-1.5 text-muted-foreground text-xs"
          data-slot="log-viewer-truncation"
        >
          Showing newest {truncatedAt} lines of this window. Narrow the window
          to see earlier lines.
        </div>
      )}
      <div
        className="flex min-h-0 flex-1 overflow-auto"
        data-slot="log-viewer-content"
      >
        <VirtualizedList
          entries={filteredEntries}
          isLive={logWindow.mode === "live"}
          onUserScrollAway={freeze}
          searchQuery={searchQuery}
        />
      </div>
    </>
  );
}
