import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import { isDeploymentPlaceholderNode } from "./deployment-placeholder-nodes";
import { deploymentTaskResultResourceRefs } from "./deployment-result-query";

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

export function deploymentTaskViewportFocusNodeIds(input: {
  nodes: readonly Node[];
  taskId: string | null | undefined;
  tasks: readonly DeploymentTaskProjection[];
}): string[] {
  const taskId = input.taskId?.trim();
  if (taskId == null || taskId === "") {
    return [];
  }

  const visiblePlaceholderNodes = input.nodes.filter(
    (node) => isDeploymentPlaceholderNode(node) && node.data.taskId === taskId
  );
  if (visiblePlaceholderNodes.length > 0) {
    return uniqueNodeIds(visiblePlaceholderNodes);
  }

  const task = input.tasks.find((item) => item.id === taskId);
  if (task === undefined) {
    return [];
  }

  const nodeByResourceKey = new Map(
    input.nodes.flatMap((node) => {
      const ref = canvasResourceIdentityFromNode(node);
      return ref === undefined ? [] : [[canvasResourceKey(ref), node] as const];
    })
  );

  return uniqueNodeIds(
    deploymentTaskResultResourceRefs(task).flatMap((ref) => {
      const node = nodeByResourceKey.get(canvasResourceKey(ref));
      return node === undefined ? [] : [node];
    })
  );
}
