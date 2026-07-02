"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DEFAULT_LIVE_SPAN_MS,
  freezeLogWindow,
  type LogWindow,
} from "./log-window";

export interface LogEntry {
  container: string;
  message: string;
  node: string;
  pod: string;
  stream: string;
  time: string;
}

export type LogsData = LogEntry[];

interface LogViewerContextValue {
  entries: LogEntry[];
  filteredEntries: LogEntry[];
  /** Freeze the current window in place, materializing live bounds. */
  freeze: () => void;
  logWindow: LogWindow;
  /** Re-anchor to now using the last live span. Always explicit. */
  resumeLive: () => void;
  searchQuery: string;
  selectedContainers: string[];
  selectedPods: string[];
  setLogWindow: (logWindow: LogWindow) => void;
  setSearchQuery: (q: string) => void;
  setSelectedContainers: (containers: string[]) => void;
  setSelectedPods: (pods: string[]) => void;
  /** When set, the fetch was truncated to the newest N lines of the window. */
  truncatedAt?: number;
  uniqueContainers: string[];
  uniquePods: string[];
}

const LogViewerContext = createContext<LogViewerContextValue | null>(null);

export function useLogViewerContext() {
  const ctx = use(LogViewerContext);
  if (!ctx) {
    throw new Error(
      "LogViewer compound components must be used within LogViewer.Provider"
    );
  }
  return ctx;
}

export function LogViewerProvider({
  logs,
  children,
  externalLogWindow,
  onLogWindowChange,
  externalSearchQuery,
  onSearchQueryChange,
  truncatedAt,
}: {
  logs: LogsData;
  children: React.ReactNode;
  externalLogWindow?: LogWindow;
  onLogWindowChange?: (logWindow: LogWindow) => void;
  externalSearchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  truncatedAt?: number;
}) {
  const [selectedPods, setSelectedPods] = useState<string[]>([]);
  const [selectedContainers, setSelectedContainers] = useState<string[]>([]);
  const [internalSearchQuery, setInternalSearchQuery] = useState("");
  const [internalLogWindow, setInternalLogWindow] = useState<LogWindow>({
    mode: "live",
    spanMs: DEFAULT_LIVE_SPAN_MS,
  });

  // Controlled-or-uncontrolled pattern
  const searchQuery =
    externalSearchQuery === undefined
      ? internalSearchQuery
      : externalSearchQuery;
  const setSearchQuery = onSearchQueryChange ?? setInternalSearchQuery;
  const logWindow = externalLogWindow ?? internalLogWindow;
  const setLogWindow = onLogWindowChange ?? setInternalLogWindow;

  const lastLiveSpanRef = useRef(DEFAULT_LIVE_SPAN_MS);
  useEffect(() => {
    if (logWindow.mode === "live") {
      lastLiveSpanRef.current = logWindow.spanMs;
    }
  }, [logWindow]);

  const freeze = useCallback(() => {
    if (logWindow.mode === "live") {
      setLogWindow(freezeLogWindow(logWindow));
    }
  }, [logWindow, setLogWindow]);

  const resumeLive = useCallback(() => {
    setLogWindow({ mode: "live", spanMs: lastLiveSpanRef.current });
  }, [setLogWindow]);

  // Windowing is the data layer's job; entries are trusted to match the
  // window. Sorting here guarantees the oldest-to-newest invariant the list,
  // chart, and live tail rely on.
  const entries = useMemo(
    () => [...logs].sort((a, b) => a.time.localeCompare(b.time)),
    [logs]
  );

  const uniquePods = useMemo(
    () => [...new Set(entries.map((e) => e.pod))].sort(),
    [entries]
  );

  const uniqueContainers = useMemo(
    () => [...new Set(entries.map((e) => e.container))].sort(),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (selectedPods.length > 0) {
      result = result.filter((e) => selectedPods.includes(e.pod));
    }
    if (selectedContainers.length > 0) {
      result = result.filter((e) => selectedContainers.includes(e.container));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((e) => e.message.toLowerCase().includes(q));
    }
    return result;
  }, [entries, selectedPods, selectedContainers, searchQuery]);

  const value: LogViewerContextValue = useMemo(
    () => ({
      entries,
      filteredEntries,
      freeze,
      logWindow,
      resumeLive,
      searchQuery,
      selectedContainers,
      selectedPods,
      setLogWindow,
      setSearchQuery,
      setSelectedContainers,
      setSelectedPods,
      truncatedAt,
      uniqueContainers,
      uniquePods,
    }),
    [
      entries,
      filteredEntries,
      freeze,
      logWindow,
      resumeLive,
      searchQuery,
      selectedContainers,
      selectedPods,
      setLogWindow,
      setSearchQuery,
      truncatedAt,
      uniqueContainers,
      uniquePods,
    ]
  );

  return (
    <LogViewerContext.Provider value={value}>
      {children}
    </LogViewerContext.Provider>
  );
}
