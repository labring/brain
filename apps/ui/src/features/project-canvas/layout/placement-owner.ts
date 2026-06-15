import type { Node } from "@xyflow/react";

import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import { canvasResourceIdentityFromNode } from "../nodes/resource-identity";
import type {
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
} from "./types";

export const DEPLOYMENT_UNKNOWN_SLOT_ID = "unknown";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function canvasResourceRefKey(ref: CanvasLayoutResourceRef): string {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

export function resourcePlacementOwner(
  ref: CanvasLayoutResourceRef
): CanvasPlacementOwner {
  return { kind: "resource", ref };
}

export function deploymentProjectionPlacementOwner(input: {
  slotId: string;
  taskId: string;
}): CanvasPlacementOwner {
  return {
    kind: "deploymentProjection",
    slotId: input.slotId,
    taskId: input.taskId,
  };
}

export function canvasPlacementOwnerKey(owner: CanvasPlacementOwner): string {
  if (owner.kind === "resource") {
    return canvasResourceRefKey(owner.ref);
  }
  return `DeploymentProjection:${owner.taskId}:${owner.slotId}`;
}

export function canvasPlacementOwnersEqual(
  a: CanvasPlacementOwner,
  b: CanvasPlacementOwner
): boolean {
  return canvasPlacementOwnerKey(a) === canvasPlacementOwnerKey(b);
}

export function canvasPlacementOwnerFromLayoutNode(
  node: CanvasLayoutNode
): CanvasPlacementOwner {
  if (node.owner !== undefined) {
    return node.owner;
  }
  if (node.ref === undefined) {
    throw new Error("Canvas layout node owner is required.");
  }
  return resourcePlacementOwner(node.ref);
}

export function canvasLayoutNodeKey(node: CanvasLayoutNode): string {
  return canvasPlacementOwnerKey(canvasPlacementOwnerFromLayoutNode(node));
}

export function canvasLayoutNodeResourceRef(
  node: CanvasLayoutNode
): CanvasLayoutResourceRef | undefined {
  const owner = canvasPlacementOwnerFromLayoutNode(node);
  return owner.kind === "resource" ? owner.ref : undefined;
}

export function canvasPlacementOwnerFromNode(
  node: Node
): CanvasPlacementOwner | undefined {
  const ref = canvasResourceIdentityFromNode(node);
  if (ref !== undefined) {
    return resourcePlacementOwner(ref);
  }
  if (node.type !== CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE) {
    return undefined;
  }
  const data = asRecord(node.data);
  const taskId = nonEmptyString(data?.taskId);
  if (taskId === undefined) {
    return undefined;
  }
  return deploymentProjectionPlacementOwner({
    slotId: nonEmptyString(data?.slotId) ?? DEPLOYMENT_UNKNOWN_SLOT_ID,
    taskId,
  });
}

export function canvasLayoutNodeFromOwner(input: {
  owner: CanvasPlacementOwner;
  position: { x: number; y: number };
  source?: CanvasLayoutNode["source"];
}): CanvasLayoutNode {
  if (input.owner.kind === "resource") {
    return {
      owner: input.owner,
      position: input.position,
      ref: input.owner.ref,
      ...(input.source === undefined ? {} : { source: input.source }),
    };
  }
  return {
    owner: input.owner,
    position: input.position,
    ...(input.source === undefined ? {} : { source: input.source }),
  };
}
