import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type { DatabaseNodeQuickActionKey } from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "@/features/project-canvas/nodes/constants";
import {
  defaultProjectSideSurfaceForNode,
  drawerSurfaceForApTerminal,
  drawerSurfaceForDbTerminal,
  mainSurfaceForDbAccess,
  mainSurfaceForResourceLogs,
  projectApTargetFromNode,
  projectCanvasSelectionFromNode,
  projectDbTargetFromNode,
  sideSurfaceForDatabasePane,
  sideSurfaceForWorkloadPane,
} from "@/features/project-canvas/surface/selection";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/features/project-surfaces/surface-state";
import type {
  ProjectCanvasCommandPlan,
  ProjectCanvasCommandSurfacePlan,
} from "./command-plan";

export type ProjectCanvasResourceSurfaceIntent =
  | {
      kind: "containerQuickAction";
      action: ContainerNodeQuickActionKey;
      node: Node;
    }
  | {
      kind: "databaseQuickAction";
      action: DatabaseNodeQuickActionKey;
      node: Node;
    }
  | { kind: "nodeClick"; node: Node };

function planWithSurface(
  surface: ProjectCanvasCommandSurfacePlan | null,
  selection: ProjectCanvasSelection | null
): ProjectCanvasCommandPlan {
  return surface == null ? { selection } : { selection, surface };
}

function sideSurfacePlan(
  entry: ProjectSideSurfaceEntry | null
): ProjectCanvasCommandSurfacePlan | null {
  return entry == null ? null : { entry, slot: "side" };
}

function mainSurfacePlan(
  entry: ProjectMainSurfaceEntry
): ProjectCanvasCommandSurfacePlan {
  return { entry, slot: "main" };
}

function drawerSurfacePlan(
  entry: ProjectDrawerSurfaceEntry
): ProjectCanvasCommandSurfacePlan {
  return { entry, slot: "drawer" };
}

function planNodeClick(node: Node): ProjectCanvasCommandPlan {
  if (node.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE) {
    return {
      stackOrder: { kind: "bringNodeToFront", nodeId: node.id },
    };
  }
  return {
    ...planWithSurface(
      sideSurfacePlan(defaultProjectSideSurfaceForNode(node)),
      projectCanvasSelectionFromNode(node)
    ),
    stackOrder: { kind: "bringNodeToFront", nodeId: node.id },
  };
}

function planContainerQuickAction({
  action,
  node,
}: Extract<
  ProjectCanvasResourceSurfaceIntent,
  { kind: "containerQuickAction" }
>): ProjectCanvasCommandPlan {
  const target = projectApTargetFromNode(node);
  const selection = projectCanvasSelectionFromNode(node);
  if (target == null) {
    return {};
  }

  switch (action) {
    case "calendar":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "history")),
        selection
      );
    case "terminal":
      return planWithSurface(
        drawerSurfacePlan(drawerSurfaceForApTerminal(target)),
        selection
      );
    case "events":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "events")),
        selection
      );
    case "logs":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForResourceLogs(target)),
        selection
      );
    case "metrics":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "metrics")),
        selection
      );
    default:
      return action satisfies never;
  }
}

function planDatabaseQuickAction({
  action,
  node,
}: Extract<
  ProjectCanvasResourceSurfaceIntent,
  { kind: "databaseQuickAction" }
>): ProjectCanvasCommandPlan {
  const target = projectDbTargetFromNode(node);
  const selection = projectCanvasSelectionFromNode(node);
  if (target == null) {
    return {};
  }

  switch (action) {
    case "terminal":
      return planWithSurface(
        drawerSurfacePlan(drawerSurfaceForDbTerminal(target)),
        selection
      );
    case "dbAccess":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForDbAccess(target)),
        selection
      );
    case "logs":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForResourceLogs(target)),
        selection
      );
    case "metrics":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForDatabasePane(target, "metrics")),
        selection
      );
    default:
      return action satisfies never;
  }
}

export function planResourceSurfaceIntent(
  intent: ProjectCanvasResourceSurfaceIntent
): ProjectCanvasCommandPlan {
  switch (intent.kind) {
    case "containerQuickAction":
      return planContainerQuickAction(intent);
    case "databaseQuickAction":
      return planDatabaseQuickAction(intent);
    case "nodeClick":
      return planNodeClick(intent.node);
    default:
      return intent satisfies never;
  }
}
