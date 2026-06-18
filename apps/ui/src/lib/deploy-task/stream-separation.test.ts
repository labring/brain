import assert from "node:assert/strict";
import { test } from "node:test";

import {
  publishDeploymentTaskProjectionChangeCore,
  subscribeDeploymentTaskProjectionEventsCore,
} from "./projection-events-core";
import {
  publishDeploymentTaskTimelineChangeCore,
  subscribeDeploymentTaskTimelineEventsCore,
} from "./timeline-events-core";
import type { DeploymentTaskTimelineSnapshotDTO, DeployTaskDTO } from "./types";

function deployTask(overrides: Partial<DeployTaskDTO> = {}): DeployTaskDTO {
  return {
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
    ...overrides,
  };
}

function timelineSnapshot(): DeploymentTaskTimelineSnapshotDTO {
  const task = deployTask();
  return {
    events: [],
    task,
    timeline: {
      revision: 2,
      status: "applying",
      steps: [],
      taskId: task.id,
      updatedAt: "2026-06-17T10:00:01.000Z",
    },
  };
}

test("deployment timeline stream publishing does not notify project projection subscribers", () => {
  const projectionEvents: unknown[] = [];
  const unsubscribeProjection = subscribeDeploymentTaskProjectionEventsCore({
    listener: (event) => projectionEvents.push(event),
    namespace: "default",
    projectId: "project-1",
  });
  const unsubscribeTimeline = subscribeDeploymentTaskTimelineEventsCore({
    listener: () => undefined,
    taskId: "task-1",
  });

  publishDeploymentTaskTimelineChangeCore(timelineSnapshot());

  unsubscribeProjection();
  unsubscribeTimeline();

  assert.deepEqual(projectionEvents, []);
});

test("project projection stream publishing does not notify deployment timeline subscribers", () => {
  const timelineEvents: unknown[] = [];
  const unsubscribeProjection = subscribeDeploymentTaskProjectionEventsCore({
    listener: () => undefined,
    namespace: "default",
    projectId: "project-1",
  });
  const unsubscribeTimeline = subscribeDeploymentTaskTimelineEventsCore({
    listener: (event) => timelineEvents.push(event),
    taskId: "task-1",
  });

  publishDeploymentTaskProjectionChangeCore(deployTask());

  unsubscribeProjection();
  unsubscribeTimeline();

  assert.deepEqual(timelineEvents, []);
});
