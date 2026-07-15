import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import { canvasResourceKey } from "../nodes/resource-identity";
import {
  type DeploymentTaskResultResourceRef,
  deploymentResultPreview,
  expectedRefToResultRef,
  resultRefForSlot,
} from "./deployment-projection-model";

export function deploymentTaskResultResourceRefs(
  task: DeploymentTaskProjection
): DeploymentTaskResultResourceRef[] {
  const refs = new Map<string, DeploymentTaskResultResourceRef>();
  const addRef = (ref: DeploymentTaskResultResourceRef | undefined) => {
    if (ref !== undefined) {
      refs.set(canvasResourceKey(ref), ref);
    }
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
