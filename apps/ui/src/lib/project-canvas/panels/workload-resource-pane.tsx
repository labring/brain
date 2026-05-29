"use client";

import type { Node } from "@xyflow/react";

import { WORKLOAD_PANE } from "@/store/canvas-store";
import type { SettingsLeaveGuardRegistration } from "./settings-leave-guard";
import { WorkloadEventsPane } from "./workload-events-panel";
import { WorkloadHistoryPane } from "./workload-history-panel";
import { WorkloadMetricsPane } from "./workload-metrics-panel";
import { WorkloadSettingsPane } from "./workload-settings-panel";

export function WorkloadResourcePane({
  mode,
  node,
  onClose,
  onSettingsLeaveGuardChange,
}: {
  mode: string | null | undefined;
  node: Node | null;
  onClose: () => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
}) {
  if (node == null) {
    return null;
  }

  switch (mode) {
    case WORKLOAD_PANE.events:
      return <WorkloadEventsPane node={node} onClose={onClose} />;
    case WORKLOAD_PANE.settings:
      return (
        <WorkloadSettingsPane
          node={node}
          onClose={onClose}
          onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
        />
      );
    case WORKLOAD_PANE.metrics:
      return <WorkloadMetricsPane node={node} onClose={onClose} />;
    case WORKLOAD_PANE.history:
      return <WorkloadHistoryPane node={node} onClose={onClose} />;
    default:
      return null;
  }
}
