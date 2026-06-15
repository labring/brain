import type { Edge, Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type {
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionSlot,
} from "@/lib/deploy-task/types";
import {
  createDeploymentProjectionContext,
  type DeploymentProjectionContext,
} from "./deployment-projection-context";
import {
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  deploymentSlotOwnerKey,
  expectedRefKey,
  resultRefForSlot,
  sanitizeNodeIdPart,
} from "./deployment-projection-model";

function nodeIdForSlot(input: {
  context: DeploymentProjectionContext;
  slot: DeploymentTaskCanvasProjectionSlot | undefined;
  task: DeploymentTaskProjection;
}): string | undefined {
  if (input.slot === undefined) {
    return undefined;
  }
  const expectedRef = resultRefForSlot({
    slot: input.slot,
    task: input.task,
  });
  if (expectedRef !== undefined) {
    const liveNode = input.context.liveNodeByExpectedRef.get(
      expectedRefKey(expectedRef)
    );
    if (liveNode !== undefined) {
      return liveNode.id;
    }
  }
  return input.context.placeholderByTaskSlotId.get(
    deploymentSlotOwnerKey(input.task.id, input.slot.id)
  )?.id;
}

function deploymentPreviewEdgeForTask(input: {
  context: DeploymentProjectionContext;
  edge: DeploymentTaskCanvasProjectionEdge;
  existingPairs: ReadonlySet<string>;
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>;
  task: DeploymentTaskProjection;
}): Edge | undefined {
  const source = nodeIdForSlot({
    context: input.context,
    slot: input.slotsById.get(input.edge.sourceSlotId),
    task: input.task,
  });
  const target = nodeIdForSlot({
    context: input.context,
    slot: input.slotsById.get(input.edge.targetSlotId),
    task: input.task,
  });
  if (
    source === undefined ||
    target === undefined ||
    input.existingPairs.has(`${source}->${target}`)
  ) {
    return undefined;
  }
  return {
    animated: true,
    data: { evidence: input.edge.evidence, kind: "deploymentPreview" },
    id: `deployment-preview-${sanitizeNodeIdPart(input.task.id)}-${sanitizeNodeIdPart(input.edge.id ?? `${input.edge.sourceSlotId}-${input.edge.targetSlotId}`)}`,
    source,
    style: {
      opacity: 0.62,
      stroke: "var(--color-blue-300)",
      strokeDasharray: "4 8",
    },
    target,
  };
}

function deploymentPreviewEdgesForTask(input: {
  context: DeploymentProjectionContext;
  existingPairs: ReadonlySet<string>;
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): Edge[] {
  const slotsById = new Map(input.preview.slots.map((slot) => [slot.id, slot]));
  return input.preview.edges.flatMap((edge) => {
    const previewEdge = deploymentPreviewEdgeForTask({
      context: input.context,
      edge,
      existingPairs: input.existingPairs,
      slotsById,
      task: input.task,
    });
    return previewEdge === undefined ? [] : [previewEdge];
  });
}

export function deploymentPreviewEdgesFromTasks(input: {
  context?: DeploymentProjectionContext;
  existingEdges?: readonly Edge[];
  nodes?: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
}): Edge[] {
  const context =
    input.context ??
    createDeploymentProjectionContext({
      nodes: input.nodes,
      previews: input.previews,
      tasks: input.tasks,
    });
  const existingPairs = new Set(
    (input.existingEdges ?? []).map((edge) => `${edge.source}->${edge.target}`)
  );
  const edges: Edge[] = [];
  for (const { preview, task } of context.previews) {
    edges.push(
      ...deploymentPreviewEdgesForTask({
        context,
        existingPairs,
        preview,
        task,
      })
    );
  }
  return edges;
}
