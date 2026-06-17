import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { selectDeploymentTaskTimelineReentry } from "./deployment-task-timeline-reentry";

function task(
  overrides: Partial<DeploymentTaskProjection>
): DeploymentTaskProjection {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    id: "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "project-1",
    status: "running",
    updatedAt: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

test("deployment task timeline re-entry ignores completed tasks", () => {
  const reentry = selectDeploymentTaskTimelineReentry({
    activeTaskId: null,
    dismissedTaskIds: new Set(),
    tasks: [
      task({
        completedAt: "2026-06-17T10:01:00.000Z",
        id: "task-completed",
        status: "completed",
        updatedAt: "2026-06-17T10:01:00.000Z",
      }),
    ],
  });

  assert.equal(reentry, null);
});

test("deployment task timeline re-entry keeps failed and blocked tasks discoverable", () => {
  const reentry = selectDeploymentTaskTimelineReentry({
    activeTaskId: null,
    dismissedTaskIds: new Set(),
    tasks: [
      task({
        id: "task-failed",
        status: "failed",
        updatedAt: "2026-06-17T10:01:00.000Z",
      }),
      task({
        id: "task-blocked",
        status: "blocked",
        updatedAt: "2026-06-17T10:02:00.000Z",
      }),
    ],
  });

  assert.equal(reentry?.task.id, "task-blocked");
  assert.equal(reentry?.label, "Deployment blocked");
});

test("deployment task timeline re-entry hides the active or dismissed task", () => {
  const reentry = selectDeploymentTaskTimelineReentry({
    activeTaskId: "task-active",
    dismissedTaskIds: new Set(["task-dismissed"]),
    tasks: [
      task({
        id: "task-active",
        status: "applying",
        updatedAt: "2026-06-17T10:03:00.000Z",
      }),
      task({
        id: "task-dismissed",
        status: "failed",
        updatedAt: "2026-06-17T10:02:00.000Z",
      }),
      task({
        id: "task-running",
        status: "running",
        updatedAt: "2026-06-17T10:01:00.000Z",
      }),
    ],
  });

  assert.equal(reentry?.task.id, "task-running");
  assert.equal(reentry?.label, "Deployment running");
});
