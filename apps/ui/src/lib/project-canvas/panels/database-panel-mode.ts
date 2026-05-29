import type { Node } from "@xyflow/react";

import { CANVAS_DATABASE_NODE_TYPE } from "@/lib/project-canvas/nodes/constants";
import { DATABASE_PANE } from "@/store/canvas-store";

export type DatabasePaneMode =
  (typeof DATABASE_PANE)[keyof typeof DATABASE_PANE];

export function normalizeDatabasePaneMode(
  value: string | null | undefined
): DatabasePaneMode | null {
  if (
    value === DATABASE_PANE.console ||
    value === DATABASE_PANE.logs ||
    value === DATABASE_PANE.metrics ||
    value === DATABASE_PANE.settings
  ) {
    return value;
  }
  return null;
}

export function databasePaneModeForNodeClick(
  node: Pick<Node, "type">
): DatabasePaneMode | null {
  return node.type === CANVAS_DATABASE_NODE_TYPE
    ? DATABASE_PANE.settings
    : null;
}

export function shouldClearDatabasePaneMode(input: {
  databasePane: string | null | undefined;
  rawNodeCount: number;
  selectedNode: Pick<Node, "type"> | null;
  serviceUid: string | null | undefined;
}): boolean {
  if (input.databasePane == null) {
    return false;
  }
  if (normalizeDatabasePaneMode(input.databasePane) == null) {
    return true;
  }
  if (input.serviceUid == null || input.serviceUid === "") {
    return true;
  }
  if (input.selectedNode == null) {
    return input.rawNodeCount > 0;
  }
  return input.selectedNode.type !== CANVAS_DATABASE_NODE_TYPE;
}
