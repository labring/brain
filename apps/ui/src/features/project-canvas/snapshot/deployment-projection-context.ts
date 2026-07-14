import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import { canvasResourceIdentityFromNode } from "../nodes/resource-identity";
import type { CanvasDeploymentPlaceholderNodeData } from "../nodes/types";
import {
  type DeploymentProjectionPlacement,
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  type DeploymentTaskResultResourceRef,
  deploymentResultPreviewByTaskId,
  deploymentResultPreviewsFromTasks,
  deploymentSlotOwnerKey,
  expectedRefKey,
  layoutNodeByOwner,
  resourceOwnerKey,
} from "./deployment-projection-model";

export interface DeploymentProjectionContext {
  layout?: CanvasLayoutDocument;
  layoutByOwner: ReadonlyMap<string, CanvasLayoutNode>;
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  nodes: readonly Node[];
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  previewByTaskId: ReadonlyMap<string, DeploymentResultPreview>;
  previews: readonly DeploymentTaskResultPreview[];
  tasks: readonly DeploymentTaskProjection[];
}

export function createDeploymentProjectionContext(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
}): DeploymentProjectionContext {
  const tasks = input.tasks ?? input.previews?.map(({ task }) => task) ?? [];
  const previews = input.previews ?? deploymentResultPreviewsFromTasks(tasks);
  const nodes = input.nodes ?? [];
  const { liveNodeByExpectedRef, placeholderByTaskSlotId } =
    deploymentProjectionNodeIndexes(nodes);

  return {
    layout: input.layout,
    layoutByOwner: layoutNodeByOwner(input.layout),
    liveNodeByExpectedRef,
    nodes,
    placeholderByTaskSlotId,
    previewByTaskId: deploymentResultPreviewByTaskId(previews),
    previews,
    tasks,
  };
}

function deploymentProjectionNodeIndexes(nodes: readonly Node[]): {
  liveNodeByExpectedRef: Map<string, Node>;
  placeholderByTaskSlotId: Map<string, Node>;
} {
  const liveNodeByExpectedRef = new Map<string, Node>();
  const placeholderByTaskSlotId = new Map<string, Node>();

  for (const node of nodes) {
    addDeploymentProjectionNodeToIndexes({
      liveNodeByExpectedRef,
      node,
      placeholderByTaskSlotId,
    });
  }

  return {
    liveNodeByExpectedRef,
    placeholderByTaskSlotId,
  };
}

function addDeploymentProjectionNodeToIndexes(input: {
  liveNodeByExpectedRef: Map<string, Node>;
  node: Node;
  placeholderByTaskSlotId: Map<string, Node>;
}): void {
  const placeholderSlot = deploymentPlaceholderSlot(input.node);
  if (placeholderSlot !== undefined) {
    input.placeholderByTaskSlotId.set(
      deploymentSlotOwnerKey(placeholderSlot.taskId, placeholderSlot.slotId),
      input.node
    );
    return;
  }

  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined) {
    input.liveNodeByExpectedRef.set(expectedRefKey(ref), input.node);
  }
}

function deploymentPlaceholderSlot(
  node: Node
): { slotId: string; taskId: string } | undefined {
  if (node.type !== CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE) {
    return undefined;
  }
  const data = node.data as Partial<CanvasDeploymentPlaceholderNodeData>;
  return typeof data.taskId === "string" && typeof data.slotId === "string"
    ? { slotId: data.slotId, taskId: data.taskId }
    : undefined;
}

export function layoutHasRefInDeploymentProjectionContext(
  context: DeploymentProjectionContext,
  ref: DeploymentTaskResultResourceRef
): boolean {
  return context.layoutByOwner.has(resourceOwnerKey(ref));
}

export function deploymentProjectionPlacementFromContext(
  context: DeploymentProjectionContext,
  input: {
    slotId: string;
    taskId: string;
  }
): DeploymentProjectionPlacement | undefined {
  const node = context.layoutByOwner.get(
    deploymentSlotOwnerKey(input.taskId, input.slotId)
  );
  if (node === undefined) {
    return undefined;
  }
  return {
    persisted: true,
    position: { x: node.position.x, y: node.position.y },
    ...(node.source === undefined ? {} : { source: node.source }),
  };
}

export function nodeForResultRefInDeploymentProjectionContext(
  context: DeploymentProjectionContext,
  ref: DeploymentTaskResultResourceRef
): Node | undefined {
  return context.liveNodeByExpectedRef.get(expectedRefKey(ref));
}

export function resultRefHasLiveNodeInDeploymentProjectionContext(
  context: DeploymentProjectionContext,
  ref: DeploymentTaskResultResourceRef
): boolean {
  return (
    nodeForResultRefInDeploymentProjectionContext(context, ref) !== undefined
  );
}

export function resultRefHasSavedLayoutInDeploymentProjectionContext(
  context: DeploymentProjectionContext,
  ref: DeploymentTaskResultResourceRef
): boolean {
  return layoutHasRefInDeploymentProjectionContext(context, ref);
}
