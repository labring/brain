import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { selectDeploymentTaskDock } from "./deployment-task-timeline-reentry";

const NOW = new Date("2026-06-17T10:04:00.000Z");

function task(
  overrides: Partial<DeploymentTaskProjection>
): DeploymentTaskProjection {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    display: {
      resultSummary: "Result pending",
      sourceKind: "docker",
      sourceSummary: "nginx:latest",
    },
    id: "task-1",
    namespace: "default",
    phase: "apply",
    projectId: "project-1",
    status: "running",
    updatedAt: "2026-06-17T10:00:00.000Z",
    ...overrides,
  };
}

test("deployment task dock prioritizes attention tasks before recent running tasks", () => {
  const dock = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: new Map(),
    now: NOW,
    tasks: [
      task({
        id: "task-running",
        status: "running",
        updatedAt: "2026-06-17T10:03:00.000Z",
      }),
      task({
        id: "task-failed",
        status: "failed",
        updatedAt: "2026-06-17T10:02:00.000Z",
      }),
      task({
        id: "task-blocked",
        status: "blocked",
        updatedAt: "2026-06-17T10:01:00.000Z",
      }),
    ],
  });

  assert.deepEqual(
    dock.tasks.map((item) => item.task.id),
    ["task-blocked", "task-failed", "task-running"]
  );
});

test("deployment task dock keeps active task visible and marks it active", () => {
  const dock = selectDeploymentTaskDock({
    activeTaskId: "task-active",
    dismissedTaskUpdatedAtById: new Map([
      ["task-active", "2026-06-17T10:03:00.000Z"],
    ]),
    now: NOW,
    tasks: [
      task({
        id: "task-active",
        status: "applying",
        updatedAt: "2026-06-17T10:03:00.000Z",
      }),
    ],
  });

  assert.equal(dock.tasks.length, 1);
  assert.equal(dock.tasks[0]?.task.id, "task-active");
  assert.equal(dock.tasks[0]?.active, true);
});

test("deployment task dock hides dismissed task only for the dismissed update", () => {
  const dismissed = new Map([["task-running", "2026-06-17T10:01:00.000Z"]]);

  const hidden = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: dismissed,
    now: NOW,
    tasks: [
      task({
        id: "task-running",
        status: "running",
        updatedAt: "2026-06-17T10:01:00.000Z",
      }),
    ],
  });
  assert.equal(hidden.tasks.length, 0);

  const visibleAfterUpdate = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: dismissed,
    now: NOW,
    tasks: [
      task({
        id: "task-running",
        status: "running",
        updatedAt: "2026-06-17T10:02:00.000Z",
      }),
    ],
  });
  assert.equal(visibleAfterUpdate.tasks.length, 1);
});

test("deployment task dock exposes desktop and mobile collapsed counts", () => {
  const dock = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: new Map(),
    now: NOW,
    tasks: [
      task({ id: "task-1" }),
      task({ id: "task-2" }),
      task({ id: "task-3" }),
      task({ id: "task-4" }),
    ],
  });

  assert.equal(dock.desktopTasks.length, 3);
  assert.equal(dock.desktopHiddenCount, 1);
  assert.equal(dock.mobileTasks.length, 1);
  assert.equal(dock.mobileHiddenCount, 3);
});

test("deployment task dock does not show completed tasks during projection grace", () => {
  const completedAt = NOW.toISOString();
  const completedTask = task({
    artifactSummary: {
      resources: [
        {
          apiVersion: "brain.io/direct",
          kind: "AP",
          name: "api",
          namespace: "default",
        },
      ],
    },
    completedAt,
    id: "task-completed",
    phase: "completed",
    status: "completed",
  });
  const duringGrace = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: new Map(),
    now: NOW,
    tasks: [completedTask],
  });
  assert.equal(duringGrace.tasks.length, 0);

  const afterGrace = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: new Map(),
    now: new Date("2026-06-17T10:06:00.000Z"),
    tasks: [completedTask],
  });
  assert.equal(afterGrace.tasks.length, 0);
});

test("deployment task dock shows completed tasks only as current-session notices", () => {
  const completedTask = task({
    artifactSummary: {
      resources: [
        {
          apiVersion: "brain.io/direct",
          kind: "AP",
          name: "api",
          namespace: "default",
        },
      ],
    },
    completedAt: NOW.toISOString(),
    id: "task-completed",
    phase: "completed",
    status: "completed",
  });

  const withoutNotice = selectDeploymentTaskDock({
    activeTaskId: null,
    dismissedTaskUpdatedAtById: new Map(),
    now: NOW,
    tasks: [completedTask],
  });
  assert.equal(withoutNotice.tasks.length, 0);

  const withNotice = selectDeploymentTaskDock({
    activeTaskId: null,
    completedNoticeTaskIds: new Set(["task-completed"]),
    dismissedTaskUpdatedAtById: new Map(),
    now: NOW,
    tasks: [completedTask],
  });
  assert.equal(withNotice.tasks.length, 1);
  assert.equal(withNotice.tasks[0]?.task.id, "task-completed");
});
