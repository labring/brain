"use client";

import { useWorkloadLogs } from "@workspace/api/hooks";
import { LogViewer } from "@workspace/ui/components/log-viewer/log-viewer";
import type { TimeRange } from "@workspace/ui/components/time-range-selector";
import type { Node } from "@xyflow/react";
import { ScrollText } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { databaseNodeDataFromNode } from "@/lib/project-canvas/nodes/database-node-data";
import { CanvasResourcePane } from "./canvas-resource-pane";
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
  const [timeRange, setTimeRange] = useState<TimeRange>(
    RESOURCE_LOGS_DEFAULT_TIME_RANGE
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
    () => resourceLogsWindow(timeRange),
    [timeRange]
  );

  const { data, error, isLoading, mutate } = useWorkloadLogs({
    enabled: open,
    getWindow,
    kubeconfig,
    limit: RESOURCE_LOGS_DEFAULT_LIMIT,
    search: debouncedSearchQuery,
    target,
    windowKey: resourceLogsWindowKey(timeRange),
  });
  const logs = useMemo(() => workloadLogsToLogEntries(data), [data]);

  if (databaseData === null) {
    return null;
  }

  const { states } = databaseData;
  const subtitle = `${states.displayEngine}${states.formattedVersion ? ` ${states.formattedVersion}` : ""} · Resource logs`;

  return (
    <CanvasResourcePane
      bodyClassName="min-h-0 gap-3.5"
      closeAriaLabel="Close database logs"
      icon={
        <ScrollText aria-hidden className="size-4 shrink-0 text-blue-500" />
      }
      onClose={onClose}
      subtitle={subtitle}
      title={`${states.name} Logs`}
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
    </CanvasResourcePane>
  );
}
