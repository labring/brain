import type { Node } from "@xyflow/react";
import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import {
  type ProjectDrawerSurfaceEntry,
  type ProjectGlobalSidePaneEntry,
  type ProjectMainSurfaceEntry,
  type ProjectSideSurfaceEntry,
  type ProjectSurfaceState,
  projectSideSurfaceVisible,
} from "@/features/project-surfaces/surface-state";
import type {
  ProjectApTarget,
  ProjectDbTarget,
  ProjectSurfaceTarget,
} from "@/features/project-surfaces/target-identity";
import { findCanvasNodeForProjectTarget } from "./selection";

type ProjectCanvasTargetedSideEntry = Extract<
  ProjectSideSurfaceEntry,
  { target: ProjectSurfaceTarget }
>;
type ProjectCanvasPendingTargetEntry =
  | ProjectCanvasTargetedSideEntry
  | ProjectDrawerSurfaceEntry
  | ProjectMainSurfaceEntry;

export type ProjectCanvasApResourcePaneKind =
  | "apEvents"
  | "apHistory"
  | "apMetrics";

export type ProjectCanvasDbResourcePaneKind = "dbMetrics";

export type ProjectCanvasResourcePaneRenderModel =
  | {
      kind: ProjectCanvasApResourcePaneKind;
      node: Node;
      target: ProjectApTarget;
    }
  | {
      databaseData: CanvasDatabaseNodeData;
      kind: ProjectCanvasDbResourcePaneKind;
      node: Node;
      target: ProjectDbTarget;
    }
  | {
      databaseData?: CanvasDatabaseNodeData;
      entryNode?: Node | null;
      kind: "settings";
      node?: Node | null;
      target: ProjectSideSurfaceEntry & { kind: "settings" };
    };

export interface ProjectCanvasPendingTargetRenderModel<
  TEntry extends
    ProjectCanvasPendingTargetEntry = ProjectCanvasPendingTargetEntry,
> {
  entry: TEntry;
  kind: "pendingTarget";
  target: ProjectSurfaceTarget;
}

export type ProjectCanvasSideRenderModel =
  | {
      content: ProjectCanvasResourcePaneRenderModel;
      kind: "resource";
    }
  | {
      entry: ProjectGlobalSidePaneEntry;
      kind: "global";
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectCanvasTargetedSideEntry>
  | null;

export type ProjectCanvasMainRenderModel =
  | {
      databaseData: CanvasDatabaseNodeData;
      kind: "dbAccess";
      node: Node;
      target: ProjectDbTarget;
    }
  | {
      kind: "apLogs";
      node: Node;
      target: ProjectApTarget;
    }
  | {
      kind: "dbLogs";
      node: Node;
      target: ProjectDbTarget;
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectMainSurfaceEntry>
  | null;

export type ProjectCanvasDrawerRenderModel =
  | {
      kind: "apTerminal";
      node: Node;
      target: ProjectApTarget;
    }
  | {
      kind: "dbTerminal";
      node: Node;
      target: ProjectDbTarget;
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectDrawerSurfaceEntry>
  | null;

export interface ProjectCanvasSurfaceRenderModel {
  drawer: ProjectCanvasDrawerRenderModel;
  main: ProjectCanvasMainRenderModel;
  side: ProjectCanvasSideRenderModel;
}

function pendingTargetModel<TEntry extends ProjectCanvasPendingTargetEntry>(
  entry: TEntry
): ProjectCanvasPendingTargetRenderModel<TEntry> {
  return { entry, kind: "pendingTarget", target: entry.target };
}

function apResourcePaneModel(
  nodes: readonly Node[],
  entry: Extract<
    ProjectSideSurfaceEntry,
    { kind: ProjectCanvasApResourcePaneKind }
  >
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  if (node == null) {
    return pendingTargetModel(entry);
  }
  return {
    content: { kind: entry.kind, node, target: entry.target },
    kind: "resource",
  };
}

function dbResourcePaneModel(
  nodes: readonly Node[],
  entry: Extract<
    ProjectSideSurfaceEntry,
    { kind: ProjectCanvasDbResourcePaneKind }
  >
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const databaseData = databaseNodeDataFromNode(node);
  if (node == null || databaseData == null) {
    return pendingTargetModel(entry);
  }
  return {
    content: { databaseData, kind: entry.kind, node, target: entry.target },
    kind: "resource",
  };
}

function settingsPaneModel(
  nodes: readonly Node[],
  entry: Extract<ProjectSideSurfaceEntry, { kind: "settings" }>
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const databaseData =
    entry.target.kind === "DB" ? databaseNodeDataFromNode(node) : undefined;

  const entryNode =
    entry.target.kind === "AP" && entry.view === "public-addresses"
      ? findCanvasNodeForProjectTarget(nodes, {
          apName: entry.target.name,
          kind: "PublicAccess",
          namespace: entry.target.namespace,
        })
      : undefined;

  return {
    content: {
      ...(databaseData == null ? {} : { databaseData }),
      ...(entryNode === undefined ? {} : { entryNode }),
      kind: "settings",
      node,
      target: entry,
    },
    kind: "resource",
  };
}

function sideRenderModel({
  nodes,
  surfaceState,
}: {
  nodes: readonly Node[];
  surfaceState: ProjectSurfaceState;
}): ProjectCanvasSideRenderModel {
  const entry = surfaceState.side;
  if (entry == null || !projectSideSurfaceVisible(surfaceState)) {
    return null;
  }

  switch (entry.kind) {
    case "apEvents":
    case "apHistory":
    case "apMetrics":
      return apResourcePaneModel(nodes, entry);
    case "dbMetrics":
      return dbResourcePaneModel(nodes, entry);
    case "settings":
      return settingsPaneModel(nodes, entry);
    case "databaseDeployment":
    case "deploymentTaskTimeline":
    case "dockerDeployment":
    case "githubDeployment":
    case "projectCreation":
    case "skillsWorkflow":
    case "templateDeployment":
      return { entry, kind: "global" };
    default:
      return entry satisfies never;
  }
}

function dbAccessMainModel(
  nodes: readonly Node[],
  entry: Extract<ProjectMainSurfaceEntry, { kind: "dbAccess" }>
): ProjectCanvasMainRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const databaseData = databaseNodeDataFromNode(node);
  if (node == null || databaseData == null) {
    return pendingTargetModel(entry);
  }
  return {
    databaseData,
    kind: "dbAccess",
    node,
    target: entry.target,
  };
}

function resourceLogsMainModel(
  nodes: readonly Node[],
  entry: Extract<ProjectMainSurfaceEntry, { kind: "resourceLogs" }>
): ProjectCanvasMainRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  if (node == null) {
    return pendingTargetModel(entry);
  }
  if (entry.target.kind === "AP") {
    return { kind: "apLogs", node, target: entry.target };
  }
  return { kind: "dbLogs", node, target: entry.target };
}

function mainRenderModel(
  nodes: readonly Node[],
  entry: ProjectMainSurfaceEntry | null
): ProjectCanvasMainRenderModel {
  if (entry == null) {
    return null;
  }
  switch (entry.kind) {
    case "dbAccess":
      return dbAccessMainModel(nodes, entry);
    case "resourceLogs":
      return resourceLogsMainModel(nodes, entry);
    default:
      return entry satisfies never;
  }
}

function drawerRenderModel(
  nodes: readonly Node[],
  entry: ProjectDrawerSurfaceEntry | null
): ProjectCanvasDrawerRenderModel {
  if (entry == null) {
    return null;
  }
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  if (node == null) {
    return pendingTargetModel(entry);
  }
  switch (entry.kind) {
    case "apTerminal":
      return { kind: "apTerminal", node, target: entry.target };
    case "dbTerminal":
      return { kind: "dbTerminal", node, target: entry.target };
    default:
      return entry satisfies never;
  }
}

export function createProjectCanvasSurfaceRenderModel({
  nodes,
  surfaceState,
}: {
  nodes: readonly Node[];
  surfaceState: ProjectSurfaceState;
}): ProjectCanvasSurfaceRenderModel {
  return {
    drawer: drawerRenderModel(nodes, surfaceState.drawer),
    main: mainRenderModel(nodes, surfaceState.main),
    side: sideRenderModel({ nodes, surfaceState }),
  };
}
