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
