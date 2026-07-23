import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS,
  deploymentTaskCanvasTopologyChanged,
  deploymentTaskCanvasTopologySignature,
  deploymentTaskProjectionIsVisible,
  nextDeploymentTaskProjectionVisibilityChangeMs,
  replaceDeploymentTaskProjections,
  selectCanvasDeploymentTaskProjections,
  toDeploymentTaskProjection,
  upsertDeploymentTaskProjection,
} from "./projection";
import { CURRENT_AI_PUBLIC_PROJECTION_VERSION } from "./schema";

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
    runner: { kind: "direct" },
    source: { kind: "docker", settings: { image: "nginx:latest" } },
    status: "queued",
    updatedAt: NOW,
    ...overrides,
  };
}

test("deployment task projection includes active project tasks", () => {
  assert.deepEqual(toDeploymentTaskProjection(deploymentTaskSource(), NOW), {
    artifactSummary: {},
    cancelRequestedAt: null,
    canvasProjection: {},
    completedAt: null,
    display: {
      resultSummary: "Result pending",
      sourceKind: "docker",
      sourceSummary: "nginx:latest",
    },
    id: "task-1",
    namespace: "default",
    phase: "queued",
    projectId: "project-uid",
    retriedFromTaskId: null,
    status: "queued",
    updatedAt: "2026-06-11T10:00:00.000Z",
  });
});

test("AI deployment projections hide generated build errors", () => {
  const projection = toDeploymentTaskProjection(
    deploymentTaskSource({
      artifactSummary: {
        buildResult: {
          error: { message: "Bearer private-build-token" },
          status: "failed",
        },
      },
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }),
    NOW
  );

  assert.ok(projection);
  assert.equal(projection.artifactSummary.buildResult, undefined);
  assert.equal(
    JSON.stringify(projection).includes("private-build-token"),
    false
  );
});

test("AI deployment projections never trust client-owned canvas fields", () => {
  const legacySecret = "abc";
  const projection = toDeploymentTaskProjection(
    deploymentTaskSource({
      artifactSummary: {
        publicProjectionVersion: CURRENT_AI_PUBLIC_PROJECTION_VERSION,
      },
      canvasProjection: {
        resultMappings: [
          {
            actualRef: {
              kind: "AP",
              name: legacySecret,
              namespace: "default",
            },
            slotId: legacySecret,
          },
        ],
        slots: [
          {
            expectedRef: {
              kind: "AP",
              name: legacySecret,
              namespace: "default",
            },
            id: legacySecret,
          },
        ],
      },
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }),
    NOW
  );

  assert.ok(projection);
  assert.deepEqual(projection.canvasProjection, {});
  assert.equal(projection.resultMappings, undefined);
  assert.equal(projection.display?.resultSummary, "Result pending");
  assert.equal(JSON.stringify(projection).includes(legacySecret), false);
  assert.equal("publicProjectionVersion" in projection.artifactSummary, false);
});

test("deployment task projection summarizes source and result resources", () => {
  assert.deepEqual(
    toDeploymentTaskProjection(
      deploymentTaskSource({
        artifactSummary: {
          resources: [
            {
              apiVersion: "brain.io/direct",
              kind: "DB",
              name: "postgres",
              namespace: "default",
            },
          ],
        },
        canvasProjection: {
          slots: [
            {
              expectedRef: {
                kind: "AP",
                name: "api",
                namespace: "default",
              },
              id: "slot-api",
            },
          ],
        },
        source: {
          kind: "github",
          repo: {
            fullName: "seal/api",
            name: "api",
            url: "https://github.com/seal/api",
          },
        },
      }),
      NOW
    )?.display,
    {
      resultSummary: "AP api + DB postgres",
      sourceKind: "github",
      sourceSummary: "seal/api",
    }
  );
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

test("deployment task projection redacts generated template internals", () => {
  const projection = toDeploymentTaskProjection(
    deploymentTaskSource({
      artifactSummary: {
        deliveryManifest: { args: { api_key: "secret", mode: "demo" } },
        deploymentPlan: {
          args: { api_key: "secret", mode: "demo" },
          inputs: [
            {
              key: "api_key",
              required: true,
              sensitive: true,
              type: "secret",
            },
            {
              key: "mode",
              required: false,
              type: "string",
            },
          ],
          kind: "sealos-template",
          templateName: "demo",
        },
        outputJson: { templateYaml: "raw" },
        resourceYamls: ["secret: api_key"],
      },
    }),
    NOW
  );

  assert.ok(projection);
  assert.equal(projection.artifactSummary.deliveryManifest, undefined);
  assert.equal(projection.artifactSummary.outputJson, undefined);
  assert.equal(projection.artifactSummary.resourceYamls, undefined);
  assert.deepEqual(projection.artifactSummary.deploymentPlan?.args, {
    mode: "demo",
  });
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

test("unchanged deployment task projection snapshots keep current references", () => {
  const first = toDeploymentTaskProjection(deploymentTaskSource(), NOW);
  const second = toDeploymentTaskProjection(
    deploymentTaskSource({ id: "task-2" }),
    NOW
  );
  assert.ok(first);
  assert.ok(second);
  const current = [first, second];

  assert.equal(
    replaceDeploymentTaskProjections(current, [{ ...first }, { ...second }]),
    current
  );
  assert.equal(upsertDeploymentTaskProjection(current, { ...second }), current);
});

test("canvas deployment task projections ignore activity-only changes", () => {
  const current = toDeploymentTaskProjection(
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
      phase: "apply",
      status: "applying",
    }),
    NOW
  );
  assert.ok(current);
  const currentCanvasTasks = [current];
  const activityUpdate = {
    ...current,
    display: {
      resultSummary: "AP api",
      sourceKind: "docker" as const,
      sourceSummary: "nginx:latest",
    },
    phase: "verify" as const,
    status: "running" as const,
    updatedAt: new Date(NOW.getTime() + 5000).toISOString(),
  };

  assert.equal(
    deploymentTaskCanvasTopologySignature(current, NOW),
    deploymentTaskCanvasTopologySignature(activityUpdate, NOW)
  );
  assert.equal(
    deploymentTaskCanvasTopologyChanged({
      current: currentCanvasTasks,
      next: [activityUpdate],
      now: NOW,
    }),
    false
  );
  assert.equal(
    selectCanvasDeploymentTaskProjections({
      current: currentCanvasTasks,
      now: NOW,
      projections: [activityUpdate],
    }),
    currentCanvasTasks
  );
});

test("canvas deployment task projections change only when topology changes", () => {
  const current = toDeploymentTaskProjection(
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
      phase: "apply",
      status: "applying",
    }),
    NOW
  );
  assert.ok(current);
  const currentCanvasTasks = [current];
  const topologyUpdate = {
    ...current,
    canvasProjection: {
      ...current.canvasProjection,
      slots: [
        ...(current.canvasProjection.slots ?? []),
        {
          expectedRef: {
            kind: "PublicAccess" as const,
            name: "api",
            namespace: "default",
          },
          id: "PublicAccess:default:api",
        },
      ],
    },
    phase: "verify" as const,
    status: "running" as const,
    updatedAt: new Date(NOW.getTime() + 5000).toISOString(),
  };

  assert.equal(
    deploymentTaskCanvasTopologyChanged({
      current: currentCanvasTasks,
      next: [topologyUpdate],
      now: NOW,
    }),
    true
  );
  assert.deepEqual(
    selectCanvasDeploymentTaskProjections({
      current: currentCanvasTasks,
      now: NOW,
      projections: [topologyUpdate],
    }),
    [topologyUpdate]
  );
});

test("completed canvas deployment task projections stay stable until grace expires", () => {
  const current = toDeploymentTaskProjection(
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
      phase: "apply",
      status: "applying",
    }),
    NOW
  );
  assert.ok(current);
  const currentCanvasTasks = [current];
  const completed = {
    ...current,
    completedAt: NOW.toISOString(),
    phase: "completed" as const,
    status: "completed" as const,
    updatedAt: new Date(NOW.getTime() + 5000).toISOString(),
  };

  assert.equal(
    selectCanvasDeploymentTaskProjections({
      current: currentCanvasTasks,
      now: NOW,
      projections: [completed],
    }),
    currentCanvasTasks
  );
  assert.deepEqual(
    selectCanvasDeploymentTaskProjections({
      current: currentCanvasTasks,
      now: new Date(
        NOW.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
      ),
      projections: [completed],
    }),
    []
  );
});

test("deployment task projection visibility schedules only real expiry ticks", () => {
  const active = toDeploymentTaskProjection(deploymentTaskSource(), NOW);
  const completed = toDeploymentTaskProjection(
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
      completedAt: NOW,
      phase: "completed",
      status: "completed",
    }),
    NOW
  );
  assert.ok(active);
  assert.ok(completed);

  assert.equal(
    nextDeploymentTaskProjectionVisibilityChangeMs([active], NOW),
    undefined
  );
  assert.equal(
    nextDeploymentTaskProjectionVisibilityChangeMs([completed], NOW),
    DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS
  );
  assert.equal(
    nextDeploymentTaskProjectionVisibilityChangeMs(
      [completed],
      new Date(
        NOW.getTime() + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS + 1
      )
    ),
    undefined
  );
});
