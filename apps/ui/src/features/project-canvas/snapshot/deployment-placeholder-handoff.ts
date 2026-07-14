import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "../layout/placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutPosition,
} from "../layout/types";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import {
  createDeploymentProjectionContext,
  type DeploymentProjectionContext,
  deploymentProjectionPlacementFromContext,
  layoutHasRefInDeploymentProjectionContext,
  resultRefHasLiveNodeInDeploymentProjectionContext,
} from "./deployment-projection-context";
import {
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  type DeploymentTaskResultResourceRef,
  materializedSlotPositions,
  resultRefForSlot,
} from "./deployment-projection-model";

export function deploymentPlaceholderHandoffs(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
  context?: DeploymentProjectionContext;
}): {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
} {
  const byNodeId = new Map<string, CanvasLayoutPosition>();
  const byRef = new Map<string, CanvasLayoutPosition>();
  const context =
    input.context ??
    createDeploymentProjectionContext({
      layout: input.layout,
      nodes: input.nodes,
      previews: input.previews,
      tasks: input.tasks,
    });
  for (const { preview, task } of context.previews) {
    addPreviewHandoffs({
      byNodeId,
      byRef,
      context,
      preview,
      task,
    });
  }
  return { byNodeId, byRef };
}

function addResultRefHandoff(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  context: DeploymentProjectionContext;
  position: CanvasLayoutPosition;
  ref: DeploymentTaskResultResourceRef;
}): void {
  if (layoutHasRefInDeploymentProjectionContext(input.context, input.ref)) {
    return;
  }
  if (
    resultRefHasLiveNodeInDeploymentProjectionContext(input.context, input.ref)
  ) {
    input.byRef.set(canvasResourceKey(input.ref), input.position);
  }
}

function addPreviewHandoffs(input: {
  byNodeId: Map<string, CanvasLayoutPosition>;
  byRef: Map<string, CanvasLayoutPosition>;
  context: DeploymentProjectionContext;
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): void {
  const materialized = materializedSlotPositions({
    layout: input.context.layout,
    slots: input.preview.slots,
    task: input.task,
  });
  const unknownSlotPlacement = deploymentProjectionPlacementFromContext(
    input.context,
    {
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: input.task.id,
    }
  );
  for (const slot of input.preview.slots) {
    const slotPlacement = deploymentProjectionPlacementFromContext(
      input.context,
      {
        slotId: slot.id,
        taskId: input.task.id,
      }
    );
    const position =
      slotPlacement?.position ??
      (unknownSlotPlacement === undefined
        ? undefined
        : materialized.positions.get(slot.id));
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (position === undefined || expectedRef === undefined) {
      continue;
    }
    addResultRefHandoff({
      byNodeId: input.byNodeId,
      byRef: input.byRef,
      context: input.context,
      position,
      ref: expectedRef,
    });
  }
}

export function deploymentPlaceholderPendingResultKeys(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
  context?: DeploymentProjectionContext;
}): {
  refs: Set<string>;
} {
  const refs = new Set<string>();
  const context =
    input.context ??
    createDeploymentProjectionContext({
      layout: input.layout,
      nodes: input.nodes,
      previews: input.previews,
      tasks: input.tasks,
    });
  for (const { preview, task } of context.previews) {
    addPreviewPendingResultKeys({
      context,
      preview,
      refs,
      task,
    });
  }
  return { refs };
}

function addPendingResultKey(input: {
  context: DeploymentProjectionContext;
  ref: DeploymentTaskResultResourceRef;
  refs: Set<string>;
}): void {
  if (
    resultRefHasLiveNodeInDeploymentProjectionContext(input.context, input.ref)
  ) {
    return;
  }
  if (!layoutHasRefInDeploymentProjectionContext(input.context, input.ref)) {
    input.refs.add(canvasResourceKey(input.ref));
  }
}

function addPreviewPendingResultKeys(input: {
  context: DeploymentProjectionContext;
  preview: DeploymentResultPreview;
  refs: Set<string>;
  task: DeploymentTaskProjection;
}): void {
  for (const slot of input.preview.slots) {
    const expectedRef = resultRefForSlot({ slot, task: input.task });
    if (
      expectedRef === undefined ||
      deploymentProjectionPlacementFromContext(input.context, {
        slotId: slot.id,
        taskId: input.task.id,
      }) !== undefined
    ) {
      continue;
    }
    addPendingResultKey({
      context: input.context,
      ref: expectedRef,
      refs: input.refs,
    });
  }
}

export function isDeploymentPlaceholderPendingResultNode(input: {
  keys: ReturnType<typeof deploymentPlaceholderPendingResultKeys>;
  node: Node;
}): boolean {
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined && input.keys.refs.has(canvasResourceKey(ref))) {
    return true;
  }
  return false;
}
