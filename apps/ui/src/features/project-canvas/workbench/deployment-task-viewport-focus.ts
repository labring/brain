import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { canvasResourceKey } from "../nodes/resource-identity";
import { isDeploymentPlaceholderNode } from "../snapshot/deployment-placeholder-nodes";
import {
  type DeploymentTaskResultResourceRef,
  deploymentResultPreview,
  expectedRefToResultRef,
  nodeForResultRef,
  resultRefForSlot,
} from "../snapshot/deployment-projection-model";

function uniqueNodeIds(nodes: readonly Node[]): string[] {
  const seen = new Set<string>();
  const nodeIds: string[] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    nodeIds.push(node.id);
  }
  return nodeIds;
}

function deploymentTaskResultRefs(
  task: DeploymentTaskProjection
): DeploymentTaskResultResourceRef[] {
  const refs = new Map<string, DeploymentTaskResultResourceRef>();
  const addRef = (ref: DeploymentTaskResultResourceRef | undefined) => {
    if (ref === undefined) {
      return;
    }
    refs.set(canvasResourceKey(ref), ref);
  };

  const preview = deploymentResultPreview(task);
  for (const slot of preview?.slots ?? []) {
    addRef(resultRefForSlot({ slot, task }));
  }
  for (const mapping of task.resultMappings ??
    task.canvasProjection.resultMappings ??
    []) {
    addRef(expectedRefToResultRef(mapping.actualRef));
  }

  return [...refs.values()];
}

export function deploymentTaskViewportFocusNodeIds(input: {
  nodes: readonly Node[];
  taskId: string | null | undefined;
  tasks: readonly DeploymentTaskProjection[];
}): string[] {
  const taskId = input.taskId?.trim();
  if (taskId == null || taskId === "") {
    return [];
  }

  const placeholderNodes = input.nodes.filter(
    (node) => isDeploymentPlaceholderNode(node) && node.data.taskId === taskId
  );
  if (placeholderNodes.length > 0) {
    return uniqueNodeIds(placeholderNodes);
  }

  const task = input.tasks.find((item) => item.id === taskId);
  if (task === undefined) {
    return [];
  }

  return uniqueNodeIds(
    deploymentTaskResultRefs(task).flatMap((ref) => {
      const node = nodeForResultRef(ref, input.nodes);
      return node === undefined ? [] : [node];
    })
  );
}
