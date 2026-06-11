"use client";

import type { NodeTypes } from "@xyflow/react";

import { CanvasContainerNode } from "@/features/project-canvas/nodes/canvas-container-node";
import { CanvasDatabaseNode } from "@/features/project-canvas/nodes/canvas-database-node";
import { CanvasDeploymentPlaceholderNode } from "@/features/project-canvas/nodes/canvas-deployment-placeholder-node";
import { CanvasEntryNode } from "@/features/project-canvas/nodes/canvas-entry-node";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";

export const WORKLOAD_PANE = {
  environmentSettings: "environment-settings",
  events: "events",
  history: "history",
  logs: "logs",
  metrics: "metrics",
  settings: "settings",
  terminal: "terminal",
} as const;

export const DATABASE_PANE = {
  logs: "logs",
  metrics: "metrics",
  settings: "settings",
  terminal: "terminal",
} as const;

export const ENTRY_PANE = {
  settings: "settings",
} as const;

/**
 * Bounds for AP fixed replicas in the workload settings panel.
 */
export const WORKLOAD_PANEL_REPLICAS = { min: 1, max: 20 } as const;

export const projectCanvasFlowNodeTypes = {
  [CANVAS_CONTAINER_NODE_TYPE]: CanvasContainerNode,
  [CANVAS_DATABASE_NODE_TYPE]: CanvasDatabaseNode,
  [CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE]: CanvasDeploymentPlaceholderNode,
  [CANVAS_ENTRY_NODE_TYPE]: CanvasEntryNode,
} as const satisfies NodeTypes;
