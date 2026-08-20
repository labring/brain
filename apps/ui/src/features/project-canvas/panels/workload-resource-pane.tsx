"use client";

import type { Node } from "@xyflow/react";

import { WORKLOAD_PANE } from "@/features/project-canvas/canvas-store";
import { WorkloadEventsPane } from "./workload-events-panel";
import { WorkloadHistoryPane } from "./workload-history-panel";
import { WorkloadMetricsPane } from "./workload-metrics-panel";

export function WorkloadResourcePane({
  mode,
  node,
  onClose,
  onWorkloadMutation,
}: {
  mode: string | null | undefined;
  node: Node | null;
  onClose: () => void;
  onWorkloadMutation?: () => Promise<unknown>;
}) {
  if (node == null) {
    return null;
  }

  switch (mode) {
    case WORKLOAD_PANE.events:
      return <WorkloadEventsPane node={node} onClose={onClose} />;
    case WORKLOAD_PANE.metrics:
      return <WorkloadMetricsPane node={node} onClose={onClose} />;
    case WORKLOAD_PANE.history:
      return (
        <WorkloadHistoryPane
          node={node}
          onClose={onClose}
          onWorkloadMutation={onWorkloadMutation}
        />
      );
    default:
      return null;
  }
}
