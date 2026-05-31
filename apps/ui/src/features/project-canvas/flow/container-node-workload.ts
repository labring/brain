import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { Node } from "@xyflow/react";

import type { WorkloadClaimKind } from "../k8s/claim-mapper";
import { CANVAS_CONTAINER_NODE_TYPE } from "../nodes/constants";

export function containerStatesFromNode(
  node: Node
): ContainerNodeStates | null {
  if (
    node.type !== CANVAS_CONTAINER_NODE_TYPE ||
    node.data === null ||
    typeof node.data !== "object" ||
    !("states" in node.data)
  ) {
    return null;
  }
  return (node.data as { states: ContainerNodeStates }).states;
}

export function workloadClaimKindFromStates(
  states: ContainerNodeStates | null
): WorkloadClaimKind {
  return states?.kind?.trim().toUpperCase() === "DB" ? "DB" : "AP";
}

export function k8sPluralKindForWorkload(wk: WorkloadClaimKind): string {
  return wk === "DB" ? "dbs" : "aps";
}

export function telemetryKindFromWorkload(wk: WorkloadClaimKind): "ap" | "db" {
  return wk === "DB" ? "db" : "ap";
}
