"use client";

import { useWorkloadLogs } from "@workspace/api/hooks";
import { LogViewer } from "@workspace/ui/components/log-viewer/log-viewer";
import type { TimeRange } from "@workspace/ui/components/time-range-selector";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { ScrollText } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { CanvasActionSurfaceFrame } from "@/lib/project-canvas/actions/canvas-action-surface";
import { containerStatesFromNode } from "@/lib/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import {
  RESOURCE_LOGS_DEFAULT_LIMIT,
  RESOURCE_LOGS_DEFAULT_TIME_RANGE,
  resourceLogsTarget,
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
  const title =
    states?.name === "" || states?.name == null ? "Logs" : states.name;
  const [timeRange, setTimeRange] = useState<TimeRange>(
    RESOURCE_LOGS_DEFAULT_TIME_RANGE
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
    () => resourceLogsWindow(timeRange),
    [timeRange]
  );
  const { data, error, isLoading, mutate } = useWorkloadLogs({
    getWindow,
    kubeconfig,
    limit: RESOURCE_LOGS_DEFAULT_LIMIT,
    search: debouncedSearchQuery,
    target,
    windowKey: resourceLogsWindowKey(timeRange),
  });
  const logs = useMemo(() => workloadLogsToLogEntries(data), [data]);

  return (
    <CanvasActionSurfaceFrame
      bodyClassName="flex min-h-0 flex-col gap-3.5 p-4"
      closeAriaLabel="Close workload logs"
      icon={<ScrollText aria-hidden className="size-4 shrink-0" />}
      onClose={onClose}
      open
      subtitle={`${states?.kind ?? "Workload"} · Resource logs`}
      title={`${title} Logs`}
    >
      {error === undefined ? null : (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-500 text-sm">
          Failed to load logs.
        </div>
      )}
      <LogViewer.Variant0
        className={isLoading ? "opacity-70" : undefined}
        logs={logs}
        onRefresh={() => {
          mutate().catch(() => undefined);
        }}
        onSearchQueryChange={setSearchQuery}
        onTimeRangeChange={setTimeRange}
        refreshMode="manual"
        searchQuery={searchQuery}
        timeRange={timeRange}
      />
    </CanvasActionSurfaceFrame>
  );
});

WorkloadLogsPane.displayName = "WorkloadLogsPane";
