import assert from "node:assert/strict";
import { test } from "node:test";

import { applyDeploymentTaskTimelineSnapshot } from "./timeline-client-state";
import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

function snapshot(input: {
  revision: number;
  taskId?: string;
  updatedAt: string;
}): DeploymentTaskTimelineSnapshotDTO {
  const taskId = input.taskId ?? "task-1";
  return {
    events: [],
    task: {
      artifactSummary: {},
      blockingInputs: [],
      canvasProjection: {},
      completedAt: null,
      createdAt: "2026-06-17T10:00:00.000Z",
      createdFrom: "ui",
      error: null,
      gatewaySessionId: null,
      gatewayTurnId: null,
      gatewayUrl: null,
      id: taskId,
      namespace: "default",
      phase: "apply",
      previewUrl: null,
      projectId: "project-1",
      projectName: "Project 1",
      resultUrl: null,
      runner: { kind: "direct" },
      runtimeName: null,
      runtimeProvider: null,
      runtimeState: null,
      source: { kind: "docker", settings: {} },
      startedAt: null,
      status: "applying",
      target: { kind: "existingProject", projectId: "project-1" },
      timelineSnapshot: null,
      updatedAt: input.updatedAt,
    },
    timeline: {
      revision: input.revision,
      status: "applying",
      steps: [],
      taskId,
      updatedAt: input.updatedAt,
    },
  };
}

test("deployment task timeline client accepts initial and newer server snapshots", () => {
  const initial = snapshot({
    revision: 1,
    updatedAt: "2026-06-17T10:00:01.000Z",
  });
  const newer = snapshot({
    revision: 2,
    updatedAt: "2026-06-17T10:00:02.000Z",
  });

  assert.equal(applyDeploymentTaskTimelineSnapshot(null, initial), initial);
  assert.equal(applyDeploymentTaskTimelineSnapshot(initial, newer), newer);
});

test("deployment task timeline client ignores stale same-task snapshots", () => {
  const current = snapshot({
    revision: 3,
    updatedAt: "2026-06-17T10:00:03.000Z",
  });
  const stale = snapshot({
    revision: 2,
    updatedAt: "2026-06-17T10:00:02.000Z",
  });

  assert.equal(applyDeploymentTaskTimelineSnapshot(current, stale), current);
});

test("deployment task timeline client uses updatedAt to resolve equal revisions", () => {
  const current = snapshot({
    revision: 3,
    updatedAt: "2026-06-17T10:00:03.000Z",
  });
  const olderEqualRevision = snapshot({
    revision: 3,
    updatedAt: "2026-06-17T10:00:02.000Z",
  });
  const newerEqualRevision = snapshot({
    revision: 3,
    updatedAt: "2026-06-17T10:00:04.000Z",
  });

  assert.equal(
    applyDeploymentTaskTimelineSnapshot(current, olderEqualRevision),
    current
  );
  assert.equal(
    applyDeploymentTaskTimelineSnapshot(current, newerEqualRevision),
    newerEqualRevision
  );
});

test("deployment task timeline client replaces state when the task id changes", () => {
  const current = snapshot({
    revision: 3,
    taskId: "task-1",
    updatedAt: "2026-06-17T10:00:03.000Z",
  });
  const nextTask = snapshot({
    revision: 1,
    taskId: "task-2",
    updatedAt: "2026-06-17T10:00:01.000Z",
  });

  assert.equal(
    applyDeploymentTaskTimelineSnapshot(current, nextTask),
    nextTask
  );
});
