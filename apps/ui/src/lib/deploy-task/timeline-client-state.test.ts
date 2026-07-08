import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeploymentTimelineStep } from "./timeline";
import { applyDeploymentTaskTimelineSnapshot } from "./timeline-client-state";
import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

function snapshot(input: {
  revision: number;
  steps?: DeploymentTimelineStep[];
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
      failureDetails: null,
      gatewayStateSnapshot: null,
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
      steps: input.steps ?? [],
      taskId,
      updatedAt: input.updatedAt,
    },
  };
}

/** Builds a fresh step whose events carry the given messages. */
function step(
  id: string,
  order: number,
  messages: string[]
): DeploymentTimelineStep {
  return {
    events: messages.map((message, index) => ({
      createdAt: "10:00:00",
      id: `${id}-e${index}`,
      message,
      severity: "info",
    })),
    id,
    label: id,
    order,
    status: "running",
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
  // Structural sharing rebuilds the winning snapshot, so it is value-equal to
  // `newer` rather than the same reference.
  assert.deepEqual(applyDeploymentTaskTimelineSnapshot(initial, newer), newer);
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
  assert.deepEqual(
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

test("deployment task timeline client keeps the current reference when an identical snapshot is re-sent", () => {
  const current = snapshot({
    revision: 5,
    steps: [step("s1", 0, ["a"]), step("s2", 1, ["b"])],
    updatedAt: "2026-06-17T10:00:05.000Z",
  });
  // A distinct object tree with identical content, as a fresh JSON.parse yields.
  const resend = snapshot({
    revision: 5,
    steps: [step("s1", 0, ["a"]), step("s2", 1, ["b"])],
    updatedAt: "2026-06-17T10:00:05.000Z",
  });

  assert.equal(applyDeploymentTaskTimelineSnapshot(current, resend), current);
});

test("deployment task timeline client reuses unchanged step references while replacing the changed one", () => {
  const current = snapshot({
    revision: 1,
    steps: [step("s1", 0, ["a"]), step("s2", 1, ["b"])],
    updatedAt: "2026-06-17T10:00:01.000Z",
  });
  const incoming = snapshot({
    revision: 2,
    steps: [step("s1", 0, ["a"]), step("s2", 1, ["b", "c"])],
    updatedAt: "2026-06-17T10:00:02.000Z",
  });

  const result = applyDeploymentTaskTimelineSnapshot(current, incoming);

  assert.notEqual(result, current);
  assert.equal(result.timeline.steps[0], current.timeline.steps[0]);
  assert.notEqual(result.timeline.steps[1], current.timeline.steps[1]);
  assert.deepEqual(result.timeline.steps[1], incoming.timeline.steps[1]);
});

test("deployment task timeline client reuses the whole task subtree when only the timeline changes", () => {
  const current = snapshot({
    revision: 1,
    steps: [step("s1", 0, ["a"])],
    updatedAt: "2026-06-17T10:00:00.000Z",
  });
  // Same task fields (identical updatedAt), only the timeline steps advance.
  const incoming = snapshot({
    revision: 2,
    steps: [step("s1", 0, ["a", "b"])],
    updatedAt: "2026-06-17T10:00:00.000Z",
  });

  const result = applyDeploymentTaskTimelineSnapshot(current, incoming);

  assert.equal(result.task, current.task);
  assert.equal(result.task.blockingInputs, current.task.blockingInputs);
  assert.notEqual(result.timeline, current.timeline);
});
