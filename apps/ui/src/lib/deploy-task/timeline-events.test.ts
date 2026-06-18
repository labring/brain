import assert from "node:assert/strict";
import { test } from "node:test";

import {
  publishDeploymentTaskTimelineChangeCore,
  subscribeDeploymentTaskTimelineEventsCore,
} from "./timeline-events-core";
import type { DeploymentTaskTimelineStreamEvent } from "./types";

test("deployment task timeline events publish only to the matching task", () => {
  const received: DeploymentTaskTimelineStreamEvent[] = [];
  const unsubscribe = subscribeDeploymentTaskTimelineEventsCore({
    listener: (event) => received.push(event),
    taskId: "task-1",
  });
  const unsubscribeOther = subscribeDeploymentTaskTimelineEventsCore({
    listener: () => {
      throw new Error("wrong task received event");
    },
    taskId: "task-2",
  });

  publishDeploymentTaskTimelineChangeCore({
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
      id: "task-1",
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
      updatedAt: "2026-06-17T10:00:01.000Z",
    },
    timeline: {
      revision: 2,
      status: "applying",
      steps: [],
      taskId: "task-1",
      updatedAt: "2026-06-17T10:00:01.000Z",
    },
  });

  unsubscribe();
  unsubscribeOther();

  assert.equal(received.length, 1);
  assert.equal(received[0]?.type, "update");
  assert.equal(received[0]?.snapshot.timeline.revision, 2);
});
