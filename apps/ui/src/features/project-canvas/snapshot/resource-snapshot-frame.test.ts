import assert from "node:assert/strict";
import { test } from "node:test";
import { DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS } from "@/features/deploy/task/projection";
import { CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS } from "../layout/missing-resource-grace";
import { canvasLayoutNodeKey } from "../layout/placement-owner";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "../layout/types";
import { projectRuntimeFactsFromResources } from "../runtime/resource-facts";
import { projectCanvasResourceSnapshotFrame } from "./resource-snapshot-frame";

const NOW_MS = Date.parse("2026-06-11T10:01:00.000Z");

function resourceNode(): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind: "DB", name: "postgres", namespace: "default" },
    },
    position: { x: 0, y: 0 },
  };
}

function projectionNode(): CanvasLayoutNode {
  return {
    owner: {
      kind: "deploymentProjection",
      slotId: "AP:default:api",
      taskId: "task-1",
    },
    position: { x: 340, y: 0 },
  };
}

test("snapshot frame uses one time sample for missing-resource and handoff grace boundaries", () => {
  const missing = resourceNode();
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [missing, projectionNode()],
    projectId: "project-uid",
    version: 7,
  };
  const relationshipIndexes = projectRuntimeFactsFromResources({
    namespace: "default",
  }).relationshipIndexes;

  const frame = projectCanvasResourceSnapshotFrame({
    canvasLayout: layout,
    canvasLayoutReady: true,
    deployTasks: [
      {
        artifactSummary: {},
        canvasProjection: {
          slots: [
            {
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "AP:default:api",
            },
          ],
        },
        completedAt: new Date(
          NOW_MS - DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS
        ).toISOString(),
        id: "task-1",
        namespace: "default",
        phase: "completed",
        projectId: "project-uid",
        status: "completed",
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    ],
    missingResourceLayoutGraceReady: true,
    nowMs: NOW_MS,
    previousMissingSinceByOwnerKey: new Map([
      [
        canvasLayoutNodeKey(missing),
        NOW_MS - CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
      ],
    ]),
    relationshipIndexes,
    resourceTopology: [],
  });

  assert.equal(frame.nowMs, NOW_MS);
  assert.deepEqual(
    frame.graph.canvasState.nodes.map((node) => node.id),
    ["deployment-result-placeholder-task-1-AP:default:api"]
  );
  assert.equal(frame.graph.layoutIntent, null);
});
