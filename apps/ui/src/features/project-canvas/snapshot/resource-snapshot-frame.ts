import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import {
  type MissingResourceLayoutGraceResult,
  resolveMissingResourceLayoutGrace,
} from "../layout/missing-resource-grace";
import type { CanvasLayoutDocument } from "../layout/types";
import {
  type ProjectCanvasRuntimeResourceGraph,
  projectCanvasRuntimeResourceGraph,
} from "../runtime/resource-graph";
import type { ProjectRuntimeRelationshipIndexes } from "../runtime/resource-relationships";
import type { ProjectRuntimeResourceTopologyItem } from "../runtime/resource-store";

function emptyMissingResourceLayoutGraceResult(): MissingResourceLayoutGraceResult {
  return {
    deleteCommands: [],
    nextMissingSinceByOwnerKey: new Map(),
    retainedLayoutOwnerKeys: new Set(),
  };
}

export function projectCanvasResourceSnapshotFrame(input: {
  canvasLayout: CanvasLayoutDocument | undefined;
  canvasLayoutReady: boolean;
  deployTasks: readonly DeploymentTaskProjection[];
  missingResourceLayoutGraceReady: boolean;
  nowMs: number;
  previousMissingSinceByOwnerKey: ReadonlyMap<string, number>;
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
  resourceTopology: readonly ProjectRuntimeResourceTopologyItem[];
}): {
  graph: ProjectCanvasRuntimeResourceGraph;
  missingResourceLayoutGrace: MissingResourceLayoutGraceResult;
  nowMs: number;
} {
  const missingResourceLayoutGrace = input.missingResourceLayoutGraceReady
    ? resolveMissingResourceLayoutGrace({
        layout: input.canvasLayout,
        nowMs: input.nowMs,
        previousMissingSinceByOwnerKey: input.previousMissingSinceByOwnerKey,
        resourceIdentities: input.resourceTopology.map((item) => item.ref),
      })
    : emptyMissingResourceLayoutGraceResult();

  const graph = projectCanvasRuntimeResourceGraph({
    canvasLayout: input.canvasLayout,
    canvasLayoutReady: input.canvasLayoutReady,
    deployTasks: [...input.deployTasks],
    layoutCommands: missingResourceLayoutGrace.deleteCommands,
    now: new Date(input.nowMs),
    relationshipIndexes: input.relationshipIndexes,
    resourceTopology: input.resourceTopology,
    retainedLayoutOwnerKeys: missingResourceLayoutGrace.retainedLayoutOwnerKeys,
  });

  return {
    graph,
    missingResourceLayoutGrace,
    nowMs: input.nowMs,
  };
}
