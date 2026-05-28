import type { Node } from "@xyflow/react";

import { CANVAS_CONTAINER_NODE_TYPE } from "@/lib/project-canvas/nodes/constants";
import { WORKLOAD_PANE } from "@/store/canvas-store";

export type WorkloadPaneMode =
  (typeof WORKLOAD_PANE)[keyof typeof WORKLOAD_PANE];

export function normalizeWorkloadPaneMode(
  value: string | null | undefined
): WorkloadPaneMode | null {
  if (
    value === WORKLOAD_PANE.events ||
    value === WORKLOAD_PANE.history ||
    value === WORKLOAD_PANE.logs ||
    value === WORKLOAD_PANE.metrics ||
    value === WORKLOAD_PANE.settings ||
    value === WORKLOAD_PANE.terminal
  ) {
    return value;
  }
  return null;
}

export function workloadPaneModeForNodeClick(
  node: Pick<Node, "type">
): WorkloadPaneMode | null {
  return node.type === CANVAS_CONTAINER_NODE_TYPE
    ? WORKLOAD_PANE.settings
    : null;
}

export function shouldClearWorkloadPaneMode(input: {
  rawNodeCount: number;
  selectedNode: Pick<Node, "type"> | null;
  serviceUid: string | null | undefined;
  workloadPane: string | null | undefined;
}): boolean {
  if (input.workloadPane == null) {
    return false;
  }
  if (normalizeWorkloadPaneMode(input.workloadPane) == null) {
    return true;
  }
  if (input.serviceUid == null || input.serviceUid === "") {
    return true;
  }
  if (input.selectedNode == null) {
    return input.rawNodeCount > 0;
  }
  return input.selectedNode.type !== CANVAS_CONTAINER_NODE_TYPE;
}
