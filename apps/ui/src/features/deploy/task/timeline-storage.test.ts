import assert from "node:assert/strict";
import { test } from "node:test";

import { deploymentTaskTimelineFromTaskRecord } from "./timeline-storage";

const NOW = new Date("2026-06-17T10:00:00.000Z");

test("deployment task timeline storage restores the persisted task-owned snapshot", () => {
  const timeline = deploymentTaskTimelineFromTaskRecord({
    id: "task-1",
    runner: { kind: "direct" },
    status: "running",
    timelineSnapshot: {
      revision: 7,
      status: "running",
      steps: [
        {
          events: [],
          id: "create-resources",
          label: "Create resources",
          order: 1,
          resultCards: [
            {
              events: [],
              id: "AP:default:api",
              required: true,
              resultRef: { kind: "AP", name: "api", namespace: "default" },
              status: "creating",
              title: "api",
            },
          ],
          status: "running",
        },
      ],
      taskId: "task-1",
      updatedAt: "2026-06-17T10:00:05.000Z",
    },
    updatedAt: NOW,
  });

  assert.equal(timeline.revision, 7);
  assert.equal(timeline.steps[0]?.resultCards?.[0]?.status, "creating");
});

test("deployment task timeline storage overlays the row status without bumping the revision", () => {
  // The runner persists the snapshot with status "blocked" before the row
  // transitions running -> blocked. A read landing in that window must not
  // derive a higher revision than reads after the transition, or the stream
  // client keeps the stale intermediate forever (no configuration form).
  const persisted = {
    revision: 7,
    status: "blocked" as const,
    steps: [],
    taskId: "task-1",
    updatedAt: "2026-06-17T10:00:05.000Z",
  };

  const betweenWrites = deploymentTaskTimelineFromTaskRecord({
    id: "task-1",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "running",
    timelineSnapshot: persisted,
    updatedAt: new Date("2026-06-17T10:00:05.100Z"),
  });
  const afterTransition = deploymentTaskTimelineFromTaskRecord({
    id: "task-1",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
    timelineSnapshot: persisted,
    updatedAt: new Date("2026-06-17T10:00:05.200Z"),
  });

  assert.equal(betweenWrites.revision, 7);
  assert.equal(betweenWrites.status, "running");
  assert.equal(betweenWrites.updatedAt, "2026-06-17T10:00:05.100Z");
  assert.equal(afterTransition.revision, 7);
  assert.equal(afterTransition.status, "blocked");
  assert.equal(afterTransition.updatedAt, "2026-06-17T10:00:05.200Z");
});

test("deployment task timeline storage initializes older tasks from runner steps", () => {
  const timeline = deploymentTaskTimelineFromTaskRecord({
    id: "task-1",
    runner: { kind: "direct" },
    status: "queued",
    timelineSnapshot: null,
    updatedAt: NOW,
  });

  assert.deepEqual(
    timeline.steps.map((step) => [step.id, step.label]),
    [
      ["validate-settings", "Validate settings"],
      ["create-resources", "Create resources"],
    ]
  );
  assert.equal(timeline.status, "queued");
});
