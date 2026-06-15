import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS,
  deploymentTaskProjectionIsVisible,
  toDeploymentTaskProjection,
  upsertDeploymentTaskProjection,
} from "./projection";

const NOW = new Date("2026-06-11T10:00:00.000Z");

function deploymentTaskSource(
  overrides: Partial<Parameters<typeof toDeploymentTaskProjection>[0]> = {}
): Parameters<typeof toDeploymentTaskProjection>[0] {
  return {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    id: "task-1",
    namespace: "default",
    phase: "queued",
    projectId: "project-uid",
    status: "queued",
    updatedAt: NOW,
    ...overrides,
  };
}

test("deployment task projection includes active project tasks", () => {
  assert.deepEqual(toDeploymentTaskProjection(deploymentTaskSource(), NOW), {
    artifactSummary: {},
    canvasProjection: {},
    completedAt: null,
    id: "task-1",
    namespace: "default",
    phase: "queued",
    projectId: "project-uid",
    status: "queued",
    updatedAt: "2026-06-11T10:00:00.000Z",
  });
});

test("deployment task projection includes terminal cleanup projections", () => {
  const failed = toDeploymentTaskProjection(
    deploymentTaskSource({
      completedAt: NOW,
      status: "failed",
    }),
    NOW
  );
  assert.ok(failed);
  assert.equal(deploymentTaskProjectionIsVisible(failed, NOW), false);

  assert.equal(
    toDeploymentTaskProjection(
      deploymentTaskSource({
        projectId: "  ",
      }),
      NOW
    ),
    null
  );
});

test("completed deployment task projection stays visible only during handoff grace", () => {
  const completedAt = NOW.toISOString();
  const projection = toDeploymentTaskProjection(
    deploymentTaskSource({
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
      phase: "completed",
      status: "completed",
    }),
    NOW
  );

  assert.ok(projection);
  assert.equal(deploymentTaskProjectionIsVisible(projection, NOW), true);
  assert.equal(
    deploymentTaskProjectionIsVisible(
      projection,
      new Date(
        NOW.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
      )
    ),
    false
  );
});

test("completed deployment task projection stays visible during grace with explicit slots", () => {
  const completedAt = NOW.toISOString();
  const projection = toDeploymentTaskProjection(
    deploymentTaskSource({
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
      completedAt,
      phase: "completed",
      status: "completed",
    }),
    NOW
  );

  assert.ok(projection);
  assert.equal(deploymentTaskProjectionIsVisible(projection, NOW), true);
  assert.equal(
    deploymentTaskProjectionIsVisible(
      projection,
      new Date(
        NOW.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
      )
    ),
    false
  );
});

test("deployment task projection exposes explicit result mappings", () => {
  assert.deepEqual(
    toDeploymentTaskProjection(
      deploymentTaskSource({
        canvasProjection: {
          resultMappings: [
            {
              actualRef: {
                kind: "AP",
                name: "api-live",
                namespace: "default",
              },
              slotId: "AP:default:api-draft",
            },
          ],
        },
      }),
      NOW
    )?.resultMappings,
    [
      {
        actualRef: {
          kind: "AP",
          name: "api-live",
          namespace: "default",
        },
        slotId: "AP:default:api-draft",
      },
    ]
  );
});

test("upserting deployment task projections keeps existing order", () => {
  const first = toDeploymentTaskProjection(deploymentTaskSource(), NOW);
  const second = toDeploymentTaskProjection(
    deploymentTaskSource({ id: "task-2" }),
    NOW
  );
  assert.ok(first);
  assert.ok(second);

  assert.deepEqual(upsertDeploymentTaskProjection([first], second), [
    second,
    first,
  ]);
  assert.deepEqual(
    upsertDeploymentTaskProjection([first, second], {
      ...second,
      phase: "apply",
      status: "running",
    }),
    [
      first,
      {
        ...second,
        phase: "apply",
        status: "running",
      },
    ]
  );
});
