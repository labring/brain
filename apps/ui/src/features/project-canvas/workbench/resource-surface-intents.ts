import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type { DatabaseNodeQuickActionKey } from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "@/features/project-canvas/nodes/constants";
import type { CanvasDeploymentPlaceholderRfNode } from "@/features/project-canvas/nodes/types";
import {
  defaultProjectSideSurfaceForNode,
  drawerSurfaceForApTerminal,
  drawerSurfaceForDbTerminal,
  mainSurfaceForDbAccess,
  mainSurfaceForResourceLogs,
  projectCanvasSelectionFromNode,
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
  ProjectApTarget,
  ProjectDbTarget,
} from "@/features/project-surfaces/target-identity";
import type {
  ProjectCanvasCommandPlan,
  ProjectCanvasCommandSurfacePlan,
} from "./command-plan";

export type ProjectCanvasResourceSurfaceIntent =
  | {
      kind: "containerQuickAction";
      action: ContainerNodeQuickActionKey;
      selection?: ProjectCanvasSelection | null;
      target: ProjectApTarget;
    }
  | {
      kind: "databaseQuickAction";
      action: DatabaseNodeQuickActionKey;
      selection?: ProjectCanvasSelection | null;
      target: ProjectDbTarget;
    }
  | {
      kind: "deploymentPlaceholderNodeClick";
      nodeId: string;
      taskId?: string;
    }
  | {
      kind: "nodeClick";
      nodeId: string;
      selection: ProjectCanvasSelection | null;
      surface: ProjectSideSurfaceEntry | null;
    };

export interface ProjectCanvasResourceSurfaceIntentOptions {
  projectId?: string;
}

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

function isDeploymentPlaceholderNode(
  node: Node
): node is CanvasDeploymentPlaceholderRfNode {
  return node.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE;
}

function nonEmptyId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed == null || trimmed === "" ? null : trimmed;
}

function planNodeClick(
  intent: Extract<ProjectCanvasResourceSurfaceIntent, { kind: "nodeClick" }>,
  _options?: ProjectCanvasResourceSurfaceIntentOptions
): ProjectCanvasCommandPlan {
  return {
    ...planWithSurface(sideSurfacePlan(intent.surface), intent.selection),
    stackOrder: { kind: "bringNodeToFront", nodeId: intent.nodeId },
  };
}

function planDeploymentPlaceholderNodeClick(
  intent: Extract<
    ProjectCanvasResourceSurfaceIntent,
    { kind: "deploymentPlaceholderNodeClick" }
  >,
  options?: ProjectCanvasResourceSurfaceIntentOptions
): ProjectCanvasCommandPlan {
  const stackOrder = {
    kind: "bringNodeToFront" as const,
    nodeId: intent.nodeId,
  };
  const timelineProjectId = nonEmptyId(options?.projectId);
  const taskId = nonEmptyId(intent.taskId);
  if (timelineProjectId == null || taskId == null) {
    return { stackOrder };
  }

  return {
    stackOrder,
    surface: {
      entry: {
        kind: "deploymentTaskTimeline",
        projectId: timelineProjectId,
        taskId,
      },
      slot: "side",
    },
  };
}

function planContainerQuickAction({
  action,
  selection,
  target,
}: Extract<
  ProjectCanvasResourceSurfaceIntent,
  { kind: "containerQuickAction" }
>): ProjectCanvasCommandPlan {
  switch (action) {
    case "calendar":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "history")),
        selection ?? { kind: "resource", target }
      );
    case "terminal":
      return planWithSurface(
        drawerSurfacePlan(drawerSurfaceForApTerminal(target)),
        selection ?? { kind: "resource", target }
      );
    case "events":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "events")),
        selection ?? { kind: "resource", target }
      );
    case "logs":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForResourceLogs(target)),
        selection ?? { kind: "resource", target }
      );
    case "metrics":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForWorkloadPane(target, "metrics")),
        selection ?? { kind: "resource", target }
      );
    default:
      return action satisfies never;
  }
}

function planDatabaseQuickAction({
  action,
  selection,
  target,
}: Extract<
  ProjectCanvasResourceSurfaceIntent,
  { kind: "databaseQuickAction" }
>): ProjectCanvasCommandPlan {
  switch (action) {
    case "terminal":
      return planWithSurface(
        drawerSurfacePlan(drawerSurfaceForDbTerminal(target)),
        selection ?? { kind: "resource", target }
      );
    case "dbAccess":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForDbAccess(target)),
        selection ?? { kind: "resource", target }
      );
    case "logs":
      return planWithSurface(
        mainSurfacePlan(mainSurfaceForResourceLogs(target)),
        selection ?? { kind: "resource", target }
      );
    case "metrics":
      return planWithSurface(
        sideSurfacePlan(sideSurfaceForDatabasePane(target, "metrics")),
        selection ?? { kind: "resource", target }
      );
    default:
      return action satisfies never;
  }
}

export function planResourceSurfaceIntent(
  intent: ProjectCanvasResourceSurfaceIntent,
  options?: ProjectCanvasResourceSurfaceIntentOptions
): ProjectCanvasCommandPlan {
  switch (intent.kind) {
    case "containerQuickAction":
      return planContainerQuickAction(intent);
    case "deploymentPlaceholderNodeClick":
      return planDeploymentPlaceholderNodeClick(intent, options);
    case "databaseQuickAction":
      return planDatabaseQuickAction(intent);
    case "nodeClick":
      return planNodeClick(intent, options);
    default:
      return intent satisfies never;
  }
}

export function projectCanvasNodeClickIntentFromNode(
  node: Node
): ProjectCanvasResourceSurfaceIntent {
  if (isDeploymentPlaceholderNode(node)) {
    return {
      kind: "deploymentPlaceholderNodeClick",
      nodeId: node.id,
      taskId: node.data.taskId,
    };
  }
  return {
    kind: "nodeClick",
    nodeId: node.id,
    selection: projectCanvasSelectionFromNode(node),
    surface: defaultProjectSideSurfaceForNode(node),
  };
}
