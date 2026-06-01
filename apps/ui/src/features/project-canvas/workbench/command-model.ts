import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type { DatabaseNodeQuickActionKey } from "@workspace/ui/components/database-node/database-node";
import type { Connection, Node } from "@xyflow/react";
import {
  classifyProjectCanvasConnectionCommand,
  type ProjectCanvasConnectionCommand,
} from "@/features/project-canvas/flow/connection-command";
import {
  defaultProjectSideSurfaceForNode,
  drawerSurfaceForApTerminal,
  drawerSurfaceForDbConsole,
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
import { projectApTarget } from "@/features/project-surfaces/target-identity";

export type ProjectCanvasCommandIntent =
  | {
      kind: "containerQuickAction";
      action: ContainerNodeQuickActionKey;
      node: Node;
    }
  | { kind: "connectingEdge"; connection: Connection }
  | {
      kind: "databaseQuickAction";
      action: DatabaseNodeQuickActionKey;
      node: Node;
    }
  | { kind: "nodeClick"; node: Node };

export type ProjectCanvasCommandSurfacePlan =
  | { entry: ProjectSideSurfaceEntry; slot: "side" }
  | { entry: ProjectMainSurfaceEntry; slot: "main" }
  | { entry: ProjectDrawerSurfaceEntry; slot: "drawer" };

export interface ProjectCanvasCommandPlan {
  feedback?: {
    message: string;
    tone: "error" | "info";
  };
  guard?: {
    action: "switch";
    kind: "settingsLeave";
  };
  pendingDbReference?: {
    apNodeId: string;
    dbName: string;
    dbNamespace: string;
  };
  selection?: ProjectCanvasSelection | null;
  stackOrder?: {
    kind: "bringNodeToFront";
    nodeId: string;
  };
  surface?: ProjectCanvasCommandSurfacePlan;
}

export interface PlanProjectCanvasCommandOptions {
  intent: ProjectCanvasCommandIntent;
  nodes: readonly Node[];
  readOnly: boolean;
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

function planNodeClick(node: Node): ProjectCanvasCommandPlan {
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
  ProjectCanvasCommandIntent,
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
    case "console":
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
  ProjectCanvasCommandIntent,
  { kind: "databaseQuickAction" }
>): ProjectCanvasCommandPlan {
  const target = projectDbTargetFromNode(node);
  const selection = projectCanvasSelectionFromNode(node);
  if (target == null) {
    return {};
  }

  switch (action) {
    case "console":
      return planWithSurface(
        drawerSurfacePlan(drawerSurfaceForDbConsole(target)),
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

function planApDbConnectionCommand(
  command: Extract<
    ProjectCanvasConnectionCommand,
    { kind: "openApDbAddReference" }
  >
): ProjectCanvasCommandPlan {
  const target = projectApTarget({
    name: command.ap.name,
    namespace: command.ap.namespace,
    observedUid: command.ap.uid,
  });
  if (target == null) {
    return {
      feedback: {
        message: "Could not open AP settings for this connection.",
        tone: "error",
      },
    };
  }

  return {
    guard: { action: "switch", kind: "settingsLeave" },
    pendingDbReference: {
      apNodeId: command.ap.nodeId,
      dbName: command.db.name,
      dbNamespace: command.db.namespace,
    },
    selection: { kind: "resource", target },
    surface: {
      entry: { kind: "apSettings", target },
      slot: "side",
    },
  };
}

function planConnectingEdge({
  connection,
  nodes,
  readOnly,
}: {
  connection: Connection;
  nodes: readonly Node[];
  readOnly: boolean;
}): ProjectCanvasCommandPlan {
  const command = classifyProjectCanvasConnectionCommand({
    connection,
    nodes,
    readOnly,
  });

  if (command.kind !== "discard") {
    return planApDbConnectionCommand(command);
  }

  if (command.reason === "readOnly") {
    return {};
  }

  return {
    feedback: {
      message: "That canvas connection is not supported yet.",
      tone: "info",
    },
  };
}

export function planProjectCanvasCommand({
  intent,
  nodes,
  readOnly,
}: PlanProjectCanvasCommandOptions): ProjectCanvasCommandPlan {
  switch (intent.kind) {
    case "containerQuickAction":
      return planContainerQuickAction(intent);
    case "connectingEdge":
      return planConnectingEdge({
        connection: intent.connection,
        nodes,
        readOnly,
      });
    case "databaseQuickAction":
      return planDatabaseQuickAction(intent);
    case "nodeClick":
      return planNodeClick(intent.node);
    default:
      return intent satisfies never;
  }
}
