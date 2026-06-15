import type { Edge, Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import type {
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionSlot,
} from "@/lib/deploy-task/types";
import { canvasResourceIdentityFromNode } from "../nodes/resource-identity";
import { isDeploymentPlaceholderNode } from "./deployment-placeholder-nodes";
import {
  type DeploymentResultPreview,
  type DeploymentTaskResultPreview,
  deploymentResultPreviewsFromTasks,
  deploymentSlotOwnerKey,
  expectedRefKey,
  resultRefForSlot,
  sanitizeNodeIdPart,
  templateNodeKeyFromNode,
} from "./deployment-projection-model";

function nodeIdForSlot(input: {
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
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
    const liveNode = input.liveNodeByExpectedRef.get(
      expectedRefKey(expectedRef)
    );
    if (liveNode !== undefined) {
      return liveNode.id;
    }
  }
  return input.placeholderByTaskSlotId.get(
    deploymentSlotOwnerKey(input.task.id, input.slot.id)
  )?.id;
}

function deploymentPreviewNodeIndexes(nodes: readonly Node[]): {
  liveNodeByExpectedRef: Map<string, Node>;
  placeholderByTaskSlotId: Map<string, Node>;
} {
  const liveNodeByExpectedRef = new Map<string, Node>();
  const placeholderByTaskSlotId = new Map<string, Node>();
  for (const node of nodes) {
    addDeploymentPreviewNodeToIndexes({
      liveNodeByExpectedRef,
      node,
      placeholderByTaskSlotId,
    });
  }
  return { liveNodeByExpectedRef, placeholderByTaskSlotId };
}

function addDeploymentPreviewNodeToIndexes(input: {
  liveNodeByExpectedRef: Map<string, Node>;
  node: Node;
  placeholderByTaskSlotId: Map<string, Node>;
}): void {
  if (isDeploymentPlaceholderNode(input.node)) {
    addDeploymentPlaceholderNodeToIndexes(input);
    return;
  }
  const ref = canvasResourceIdentityFromNode(input.node);
  if (ref !== undefined) {
    input.liveNodeByExpectedRef.set(expectedRefKey(ref), input.node);
    return;
  }
  const templateKey = templateNodeKeyFromNode(input.node);
  if (templateKey !== undefined) {
    const [namespace, name] = templateKey.split("/");
    if (namespace !== undefined && name !== undefined) {
      input.liveNodeByExpectedRef.set(
        expectedRefKey({ kind: "TemplateNative", name, namespace }),
        input.node
      );
    }
  }
}

function addDeploymentPlaceholderNodeToIndexes(input: {
  node: Node;
  placeholderByTaskSlotId: Map<string, Node>;
}): void {
  if (!isDeploymentPlaceholderNode(input.node)) {
    return;
  }
  if (input.node.data.slotId === undefined) {
    return;
  }
  input.placeholderByTaskSlotId.set(
    deploymentSlotOwnerKey(input.node.data.taskId, input.node.data.slotId),
    input.node
  );
}

function deploymentPreviewEdgeForTask(input: {
  edge: DeploymentTaskCanvasProjectionEdge;
  existingPairs: ReadonlySet<string>;
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  slotsById: ReadonlyMap<string, DeploymentTaskCanvasProjectionSlot>;
  task: DeploymentTaskProjection;
}): Edge | undefined {
  const source = nodeIdForSlot({
    liveNodeByExpectedRef: input.liveNodeByExpectedRef,
    placeholderByTaskSlotId: input.placeholderByTaskSlotId,
    slot: input.slotsById.get(input.edge.sourceSlotId),
    task: input.task,
  });
  const target = nodeIdForSlot({
    liveNodeByExpectedRef: input.liveNodeByExpectedRef,
    placeholderByTaskSlotId: input.placeholderByTaskSlotId,
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
  existingPairs: ReadonlySet<string>;
  liveNodeByExpectedRef: ReadonlyMap<string, Node>;
  placeholderByTaskSlotId: ReadonlyMap<string, Node>;
  preview: DeploymentResultPreview;
  task: DeploymentTaskProjection;
}): Edge[] {
  const slotsById = new Map(input.preview.slots.map((slot) => [slot.id, slot]));
  return input.preview.edges.flatMap((edge) => {
    const previewEdge = deploymentPreviewEdgeForTask({
      edge,
      existingPairs: input.existingPairs,
      liveNodeByExpectedRef: input.liveNodeByExpectedRef,
      placeholderByTaskSlotId: input.placeholderByTaskSlotId,
      slotsById,
      task: input.task,
    });
    return previewEdge === undefined ? [] : [previewEdge];
  });
}

export function deploymentPreviewEdgesFromTasks(input: {
  existingEdges?: readonly Edge[];
  nodes: readonly Node[];
  previews?: readonly DeploymentTaskResultPreview[];
  tasks?: readonly DeploymentTaskProjection[];
}): Edge[] {
  const { liveNodeByExpectedRef, placeholderByTaskSlotId } =
    deploymentPreviewNodeIndexes(input.nodes);
  const existingPairs = new Set(
    (input.existingEdges ?? []).map((edge) => `${edge.source}->${edge.target}`)
  );
  const edges: Edge[] = [];
  const previews =
    input.previews ?? deploymentResultPreviewsFromTasks(input.tasks);
  for (const { preview, task } of previews) {
    edges.push(
      ...deploymentPreviewEdgesForTask({
        existingPairs,
        liveNodeByExpectedRef,
        placeholderByTaskSlotId,
        preview,
        task,
      })
    );
  }
  return edges;
}
