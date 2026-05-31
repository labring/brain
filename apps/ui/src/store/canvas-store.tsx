"use client";

import type { NodeTypes } from "@xyflow/react";

import { CanvasContainerNode } from "@/lib/project-canvas/nodes/canvas-container-node";
import { CanvasDatabaseNode } from "@/lib/project-canvas/nodes/canvas-database-node";
import { CanvasEntryNode } from "@/lib/project-canvas/nodes/canvas-entry-node";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/lib/project-canvas/nodes/constants";

export const WORKLOAD_PANE = {
  events: "events",
  history: "history",
  logs: "logs",
  metrics: "metrics",
  settings: "settings",
  terminal: "terminal",
} as const;

export const DATABASE_PANE = {
  console: "console",
  logs: "logs",
  metrics: "metrics",
  settings: "settings",
} as const;

export const ENTRY_PANE = {
  settings: "settings",
} as const;

/**
 * Bounds for AP fixed replicas in the workload Settings panel (`ContainerSettingsPane`).
 * Matches `packages/crossplane/public/service/ap/ap.yaml` (`minimum` / `maximum`).
 */
export const WORKLOAD_PANEL_REPLICAS = { min: 1, max: 20 } as const;

export const projectCanvasFlowNodeTypes = {
  [CANVAS_CONTAINER_NODE_TYPE]: CanvasContainerNode,
  [CANVAS_DATABASE_NODE_TYPE]: CanvasDatabaseNode,
  [CANVAS_ENTRY_NODE_TYPE]: CanvasEntryNode,
} as const satisfies NodeTypes;
