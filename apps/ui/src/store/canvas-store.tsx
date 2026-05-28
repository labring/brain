"use client";

import type { CanvasSelectedEdge } from "@workspace/ui/components/canvas/canvas.types";
import type { Node, NodeTypes } from "@xyflow/react";
import { atom } from "jotai";

import { CanvasContainerNode } from "@/lib/project-canvas/nodes/canvas-container-node";
import { CanvasDatabaseNode } from "@/lib/project-canvas/nodes/canvas-database-node";
import { CanvasEntryNode } from "@/lib/project-canvas/nodes/canvas-entry-node";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/lib/project-canvas/nodes/constants";
import { canvasNodeSelectionKey } from "@/lib/project-canvas/nodes/resource-identity";

/** nuqs key for the selected workload card (Kubernetes `metadata.uid`). */
export const CANVAS_SERVICE_QUERY_KEY = "service" as const;

/** nuqs key for the AP / Container Node action pane (`?apPane=settings|metrics|terminal|logs|history`). */
export const WORKLOAD_PANE_QUERY_KEY = "apPane" as const;

/** nuqs key for the database action pane (`?dbPane=settings|metrics`). */
export const DATABASE_PANE_QUERY_KEY = "dbPane" as const;

/** nuqs key for the EntryPoint action pane (`?entryPane=settings`). */
export const ENTRY_PANE_QUERY_KEY = "entryPane" as const;

export const WORKLOAD_PANE = {
  events: "events",
  history: "history",
  logs: "logs",
  metrics: "metrics",
  settings: "settings",
  terminal: "terminal",
} as const;

export const DATABASE_PANE = {
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

export function projectCanvasNodeServiceUid(node: Node): string | null {
  return canvasNodeSelectionKey(node);
}

export const projectCanvasFlowNodeTypes = {
  [CANVAS_CONTAINER_NODE_TYPE]: CanvasContainerNode,
  [CANVAS_DATABASE_NODE_TYPE]: CanvasDatabaseNode,
  [CANVAS_ENTRY_NODE_TYPE]: CanvasEntryNode,
} as const satisfies NodeTypes;

export const selectedEdgeAtom = atom<CanvasSelectedEdge>(null);
