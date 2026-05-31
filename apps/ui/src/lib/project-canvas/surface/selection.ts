import type { Node } from "@xyflow/react";

import { CANVAS_ENTRY_NODE_TYPE } from "@/lib/project-canvas/nodes/constants";
import {
  canvasEntryPointApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceLastSeenUidFromNode,
} from "@/lib/project-canvas/nodes/resource-identity";
import type {
  ProjectCanvasSelection,
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/lib/project-surfaces/surface-state";
import {
  type ProjectApTarget,
  type ProjectDbTarget,
  type ProjectResourceTarget,
  type ProjectSurfaceTarget,
  projectApBoundEntryPointTarget,
  projectApTarget,
  projectDbTarget,
  targetsEqual,
} from "@/lib/project-surfaces/target-identity";
import { DATABASE_PANE, WORKLOAD_PANE } from "@/store/canvas-store";

export function projectSurfaceTargetFromCanvasNode(
  node: Node
): ProjectSurfaceTarget | null {
  const observedUid = canvasResourceLastSeenUidFromNode(node);
  if (node.type === CANVAS_ENTRY_NODE_TYPE) {
    const identity = canvasResourceIdentityFromNode(node);
    if (identity?.kind !== "EntryPoint") {
      return null;
    }
    return projectApBoundEntryPointTarget({
      apName: identity.name,
      namespace: identity.namespace,
      observedUid,
    });
  }

  const identity = canvasResourceIdentityFromNode(node);
  if (identity?.kind === "AP") {
    return projectApTarget({
      name: identity.name,
      namespace: identity.namespace,
      observedUid,
    });
  }
  if (identity?.kind === "DB") {
    return projectDbTarget({
      name: identity.name,
      namespace: identity.namespace,
      observedUid,
    });
  }
  return null;
}

export function projectCanvasSelectionFromNode(
  node: Node
): ProjectCanvasSelection | null {
  const target = projectSurfaceTargetFromCanvasNode(node);
  if (target == null) {
    return null;
  }
  if (target.kind === "EntryPoint") {
    return { kind: "publicAddresses", target };
  }
  return { kind: "resource", target };
}

export function defaultProjectSideSurfaceForNode(
  node: Node
): ProjectSideSurfaceEntry | null {
  const target = projectSurfaceTargetFromCanvasNode(node);
  if (target?.kind === "AP") {
    return { kind: "apSettings", target };
  }
  if (target?.kind === "DB") {
    return { kind: "dbSettings", target };
  }
  if (target?.kind === "EntryPoint") {
    return { kind: "publicAddresses", target };
  }
  return null;
}

export function sideSurfaceForWorkloadPane(
  target: ProjectApTarget,
  pane: string
): ProjectSideSurfaceEntry | null {
  switch (pane) {
    case WORKLOAD_PANE.events:
      return { kind: "apEvents", target };
    case WORKLOAD_PANE.history:
      return { kind: "apHistory", target };
    case WORKLOAD_PANE.metrics:
      return { kind: "apMetrics", target };
    case WORKLOAD_PANE.settings:
      return { kind: "apSettings", target };
    default:
      return null;
  }
}

export function sideSurfaceForDatabasePane(
  target: ProjectDbTarget,
  pane: string
): ProjectSideSurfaceEntry | null {
  switch (pane) {
    case DATABASE_PANE.metrics:
      return { kind: "dbMetrics", target };
    case DATABASE_PANE.settings:
      return { kind: "dbSettings", target };
    default:
      return null;
  }
}

export function mainSurfaceForResourceLogs(
  target: ProjectResourceTarget
): ProjectMainSurfaceEntry {
  return { kind: "resourceLogs", target };
}

export function drawerSurfaceForApTerminal(
  target: ProjectApTarget
): ProjectDrawerSurfaceEntry {
  return { kind: "apTerminal", target };
}

export function drawerSurfaceForDbConsole(
  target: ProjectDbTarget
): ProjectDrawerSurfaceEntry {
  return { kind: "dbConsole", target };
}

export function mainSurfaceForDbAccess(
  target: ProjectDbTarget
): ProjectMainSurfaceEntry {
  return { kind: "dbAccess", target };
}

export function projectSurfaceTargetMatchesCanvasNode(
  target: ProjectSurfaceTarget,
  node: Node
): boolean {
  const nodeTarget = projectSurfaceTargetFromCanvasNode(node);
  if (targetsEqual(target, nodeTarget)) {
    return true;
  }

  if (target.kind !== "EntryPoint") {
    return false;
  }

  const apIdentity = canvasEntryPointApResourceIdentityFromNode(node);
  return (
    apIdentity?.kind === "AP" &&
    apIdentity.namespace === target.namespace &&
    apIdentity.name === target.apName
  );
}

export function findCanvasNodeForProjectTarget(
  nodes: readonly Node[],
  target: ProjectSurfaceTarget | null | undefined
): Node | null {
  if (target == null) {
    return null;
  }

  return (
    nodes.find((node) => projectSurfaceTargetMatchesCanvasNode(target, node)) ??
    null
  );
}

export function projectTargetExistsOnCanvas(
  nodes: readonly Node[],
  target: ProjectSurfaceTarget | null | undefined
): boolean {
  if (target == null) {
    return false;
  }
  if (target.kind !== "EntryPoint") {
    return findCanvasNodeForProjectTarget(nodes, target) != null;
  }

  return nodes.some((node) => {
    const identity = canvasResourceIdentityFromNode(node);
    return (
      identity?.kind === "AP" &&
      identity.namespace === target.namespace &&
      identity.name === target.apName
    );
  });
}

export function projectSelectionNode(
  nodes: readonly Node[],
  selection: ProjectCanvasSelection | null | undefined
): Node | null {
  if (selection == null || selection.kind === "edge") {
    return null;
  }
  return findCanvasNodeForProjectTarget(nodes, selection.target);
}

export function projectSelectionTargetExists(
  nodes: readonly Node[],
  selection: ProjectCanvasSelection | null | undefined
): boolean {
  if (selection == null) {
    return true;
  }
  if (selection.kind === "edge") {
    return true;
  }
  return projectTargetExistsOnCanvas(nodes, selection.target);
}

export function projectApTargetFromNode(node: Node): ProjectApTarget | null {
  const target = projectSurfaceTargetFromCanvasNode(node);
  return target?.kind === "AP" ? target : null;
}

export function projectDbTargetFromNode(node: Node): ProjectDbTarget | null {
  const target = projectSurfaceTargetFromCanvasNode(node);
  return target?.kind === "DB" ? target : null;
}

export function projectCanvasNodeSelectionKey(node: Node): string | null {
  const selection = projectCanvasSelectionFromNode(node);
  if (selection == null) {
    return null;
  }
  if (selection.kind === "resource") {
    return `${selection.target.kind}:${selection.target.namespace}:${selection.target.name}`;
  }
  if (selection.kind !== "publicAddresses") {
    return null;
  }
  return `EntryPoint:${selection.target.namespace}:${selection.target.apName}`;
}
