"use client";

import { useWorkloadLogs } from "@workspace/api/hooks";
import { LogViewer } from "@workspace/ui/components/log-viewer/log-viewer";
import type { LogWindow } from "@workspace/ui/components/log-viewer/log-window";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { FileText } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { MainActionSurfaceFrame } from "@/features/project-canvas/actions/canvas-action-surface";
import { containerStatesFromNode } from "@/features/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
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

export const WorkloadLogsPane = memo(function WorkloadLogsPane({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const name =
    states?.name === "" || states?.name == null
      ? "Logs"
      : (states.displayName ?? states.name);
  const [logWindow, setLogWindow] = useState<LogWindow>(
    RESOURCE_LOGS_DEFAULT_WINDOW
  );
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(
    searchQuery,
    LOG_SEARCH_DEBOUNCE_MS
  );

  const target = useMemo(
    () =>
      resourceLogsTarget({
        kind: "ap",
        name: states?.name,
        namespace: states?.namespace?.trim() || ns,
      }),
    [states?.name, states?.namespace, ns]
  );
  const getWindow = useCallback(
    () => resourceLogsWindow(logWindow),
    [logWindow]
  );
  const { data, error, isLoading } = useWorkloadLogs({
    getWindow,
    kubeconfig,
    limit: RESOURCE_LOGS_DEFAULT_LIMIT,
    refreshIntervalMs: resourceLogsRefreshIntervalMs(logWindow),
    search: debouncedSearchQuery,
    target,
    windowKey: resourceLogsWindowKey(logWindow),
  });
  const logs = useMemo(() => workloadLogsToLogEntries(data), [data]);

  return (
    <MainActionSurfaceFrame
      bodyClassName="flex min-h-0 flex-col gap-3.5 p-4"
      closeAriaLabel="Close workload logs"
      icon={<FileText aria-hidden className="size-4 shrink-0" />}
      onClose={onClose}
      open
      subtitle={name}
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
});

WorkloadLogsPane.displayName = "WorkloadLogsPane";
