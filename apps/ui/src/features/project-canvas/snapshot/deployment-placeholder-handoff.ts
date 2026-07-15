import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type {
  CanvasLayoutDocument,
  CanvasLayoutPosition,
} from "../layout/types";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import {
  type DeploymentHandoffReconciliation,
  deploymentHandoffReconciliations,
} from "./deployment-handoff-reconciliation";
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
  resultRefForSlot,
} from "./deployment-projection-model";

export function deploymentPlaceholderHandoffs(input: {
  layout?: CanvasLayoutDocument;
  nodes?: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
  context?: DeploymentProjectionContext;
  reconciliations?: ReadonlyMap<string, DeploymentHandoffReconciliation>;
}): Map<string, CanvasLayoutPosition> {
  const byRef = new Map<string, CanvasLayoutPosition>();
  const context =
    input.context ??
    createDeploymentProjectionContext({
      layout: input.layout,
      nodes: input.nodes,
      previews: input.previews,
      tasks: input.tasks,
    });
  const reconciliations =
    input.reconciliations ?? deploymentHandoffReconciliations(context);
  for (const [key, reconciliation] of reconciliations) {
    if (
      !reconciliation.resourceAlreadyPlaced &&
      reconciliation.position !== undefined
    ) {
      byRef.set(key, reconciliation.position);
    }
  }
  return byRef;
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
