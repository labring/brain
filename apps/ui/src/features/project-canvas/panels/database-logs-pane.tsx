"use client";

import { useWorkloadLogs } from "@workspace/api/hooks";
import { LogViewer } from "@workspace/ui/components/log-viewer/log-viewer";
import type { LogWindow } from "@workspace/ui/components/log-viewer/log-window";
import type { Node } from "@xyflow/react";
import { FileText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { MainActionSurfaceFrame } from "@/features/project-canvas/actions/canvas-action-surface";
import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";
import {
  RESOURCE_LOGS_DEFAULT_LIMIT,
  RESOURCE_LOGS_DEFAULT_WINDOW,
  resourceLogsRefreshIntervalMs,
  resourceLogsTarget,
  resourceLogsTruncatedAt,
  resourceLogsWindow,
  resourceLogsWindowKey,
  workloadLogsToLogEntries,
} from "./logs-pane-data";
import { useDebouncedValue } from "./use-debounced-value";

const LOG_SEARCH_DEBOUNCE_MS = 400;

export interface DatabaseLogsPaneProps {
  kubeconfig?: string;
  node: Node | null;
  onClose: () => void;
  open: boolean;
}

export function DatabaseLogsPane({
  kubeconfig,
  node,
  onClose,
  open,
}: DatabaseLogsPaneProps) {
  const databaseData = open ? databaseNodeDataFromNode(node) : null;
  const [logWindow, setLogWindow] = useState<LogWindow>(
    RESOURCE_LOGS_DEFAULT_WINDOW
  );
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(
    searchQuery,
    LOG_SEARCH_DEBOUNCE_MS
  );
  const target = useMemo(() => {
    if (databaseData === null) {
      return null;
    }
    return resourceLogsTarget({
      kind: "db",
      name: databaseData.workload.name,
      namespace: databaseData.workload.namespace,
    });
  }, [databaseData]);
  const getWindow = useCallback(
    () => resourceLogsWindow(logWindow),
    [logWindow]
  );

  const { data, error, isLoading } = useWorkloadLogs({
    enabled: open,
    getWindow,
    kubeconfig,
    limit: RESOURCE_LOGS_DEFAULT_LIMIT,
    refreshIntervalMs: open ? resourceLogsRefreshIntervalMs(logWindow) : 0,
    search: debouncedSearchQuery,
    target,
    windowKey: resourceLogsWindowKey(logWindow),
  });
  const logs = useMemo(() => workloadLogsToLogEntries(data), [data]);

  if (databaseData === null) {
    return null;
  }

  const { states } = databaseData;
  return (
    <MainActionSurfaceFrame
      bodyClassName="flex min-h-0 flex-col gap-3.5 p-4"
      closeAriaLabel="Close database logs"
      icon={<FileText aria-hidden className="size-4 shrink-0" />}
      onClose={onClose}
      open={open}
      subtitle={states.name}
      title="Logs"
    >
      {error === undefined ? null : (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-500 text-sm">
          Failed to load logs.
        </div>
      )}
      <LogViewer.Variant0
        className={isLoading ? "opacity-70" : undefined}
        logs={logs}
        logWindow={logWindow}
        onLogWindowChange={setLogWindow}
        onSearchQueryChange={setSearchQuery}
        searchQuery={searchQuery}
        truncatedAt={resourceLogsTruncatedAt(logs)}
      />
    </MainActionSurfaceFrame>
  );
}
