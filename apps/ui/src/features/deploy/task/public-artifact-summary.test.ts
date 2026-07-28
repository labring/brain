import assert from "node:assert/strict";
import { test } from "node:test";

import {
  publicDeployTaskArtifactSummary,
  publicDeployTaskBlockingInputs,
  publicDeployTaskEventFields,
  publicDeployTaskEventPayload,
  publicDeployTaskGatewayLocator,
  publicDeployTaskRuntimeLocator,
  publicDeployTaskTimelineSnapshot,
} from "./public-artifact-summary";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
  type DeployTaskArtifactSummary,
  type DeployTaskBlockingInput,
} from "./schema";
import type { DeploymentTaskTimelineSnapshot } from "./timeline";

const TEMPLATE_SUMMARY = {
  buildResult: {
    error: { message: "Bearer private-build-token" },
    status: "failed",
  },
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
    kind: "sealos-template" as const,
    templateName: "demo",
  },
  outputJson: { templateYaml: "raw" },
  resourceYamls: ["secret: api_key"],
} satisfies DeployTaskArtifactSummary;

test("public artifact summary hides generated template internals", () => {
  const summary = publicDeployTaskArtifactSummary(TEMPLATE_SUMMARY, {
    runner: { kind: "direct" },
  });

  assert.equal(summary.deliveryManifest, undefined);
  assert.deepEqual(summary.buildResult, TEMPLATE_SUMMARY.buildResult);
  assert.equal(summary.outputJson, undefined);
  assert.equal(summary.resourceYamls, undefined);
  assert.deepEqual(summary.deploymentPlan?.args, { mode: "demo" });
});

test("public AI artifact summary hides generated build errors", () => {
  const summary = publicDeployTaskArtifactSummary(TEMPLATE_SUMMARY, {
    runner: { kind: "ai", runtimeProvider: "devbox" },
  });

  assert.equal(summary.buildResult, undefined);
  assert.equal(JSON.stringify(summary).includes("private-build-token"), false);
});

test("trusted public AI artifact summary allowlists nested fields", () => {
  const legacySecret = "legacy-ai-output-secret";
  const summary = publicDeployTaskArtifactSummary(
    {
      appliedResources: [{ name: legacySecret }],
      artifacts: [{ build: { token: legacySecret }, unknown: legacySecret }],
      buildResult: { error: legacySecret },
      deliveryManifest: { args: { api_key: legacySecret } },
      deploymentPlan: {
        args: {
          api_key: legacySecret,
          port: "8080",
          undeclared: legacySecret,
        },
        defaults: {
          api_key: { type: "string", value: legacySecret },
          port: { type: "number", value: "8080" },
          undeclared: { value: legacySecret },
        },
        inputs: [
          {
            default: legacySecret,
            key: "api_key",
            options: [legacySecret],
            required: true,
            sensitive: true,
            type: "secret",
          },
          {
            default: "3000",
            key: "port",
            required: false,
            type: "number",
          },
        ],
        kind: "sealos-template",
        missingInputKeys: ["api_key", "port", "unknown"],
        templateName: "demo",
      },
      entrypointYaml: legacySecret,
      notes: legacySecret,
      outputJson: { token: legacySecret },
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
      resources: [
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: "demo",
          namespace: "ns-demo",
          token: legacySecret,
        },
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: legacySecret,
        },
      ],
      resourceYamls: [`token: ${legacySecret}`],
      resultIdentities: { templateInstanceName: legacySecret },
    } as unknown as DeployTaskArtifactSummary,
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(summary, {
    appliedResources: [{}],
    deploymentPlan: {
      inputs: [
        {
          key: "configuration-1",
          label: "Configuration value",
          required: true,
          sensitive: true,
          type: "secret",
        },
        {
          key: "configuration-2",
          label: "Configuration value",
          required: false,
          type: "number",
        },
      ],
      kind: "sealos-template",
      missingInputKeys: ["configuration-1", "configuration-2"],
      templateName: "deployment",
    },
    resources: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name: "demo",
        namespace: "ns-demo",
      },
    ],
  });
  assert.equal(JSON.stringify(summary).includes(legacySecret), false);
  assert.equal("publicProjectionVersion" in summary, false);
});

test("stamped public AI blocking inputs keep generated metadata fail-closed", () => {
  const legacySecret = "legacy-blocking-input-secret";
  const blockingInputs = publicDeployTaskBlockingInputs(
    [
      {
        defaultValue: legacySecret,
        description: "API key",
        id: "API_KEY",
        key: "API_KEY",
        label: "API key",
        options: [legacySecret],
        required: true,
        sensitive: true,
        type: "secret",
        valueType: "secret",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        unknown: legacySecret,
      } as DeployTaskBlockingInput,
    ],
    {
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(blockingInputs, [
    {
      id: "configuration-1",
      key: "configuration-1",
      label: "Configuration value",
      required: true,
      sensitive: true,
      type: "secret",
    },
  ]);
  assert.equal(JSON.stringify(blockingInputs).includes(legacySecret), false);
});

test("legacy public AI inputs use opaque aliases", () => {
  const legacySecret = "abc";
  const summary = publicDeployTaskArtifactSummary(
    {
      deploymentPlan: {
        inputs: [
          {
            key: legacySecret,
            label: legacySecret,
            required: true,
            sensitive: true,
            type: "secret",
          },
        ],
        kind: "sealos-template",
        missingInputKeys: [legacySecret],
        templateName: legacySecret,
      },
      resources: [
        {
          apiVersion: "apps/v1",
          kind: "AP",
          name: legacySecret,
          namespace: "ns-demo",
        },
      ],
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );
  const blockingInputs = publicDeployTaskBlockingInputs(
    [
      {
        id: legacySecret,
        key: legacySecret,
        label: legacySecret,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(summary, {
    deploymentPlan: {
      inputs: [
        {
          key: "configuration-1",
          label: "Configuration value",
          required: true,
          sensitive: true,
          type: "secret",
        },
      ],
      kind: "sealos-template",
      missingInputKeys: ["configuration-1"],
      templateName: "deployment",
    },
  });
  assert.deepEqual(blockingInputs, [
    {
      id: "configuration-1",
      key: "configuration-1",
      label: "Configuration value",
      required: true,
      sensitive: true,
      type: "secret",
    },
  ]);
  assert.equal(
    JSON.stringify({ blockingInputs, summary }).includes(legacySecret),
    false
  );
});

test("stamped public AI blockers always use opaque identifiers", () => {
  const blockingInputs = publicDeployTaskBlockingInputs(
    [
      {
        id: "_API_KEY",
        key: "_API_KEY",
        label: "API key",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(blockingInputs, [
    {
      id: "configuration-1",
      key: "configuration-1",
      label: "Configuration value",
      required: true,
      sensitive: true,
      type: "secret",
    },
  ]);
  assert.equal(JSON.stringify(blockingInputs).includes("_API_KEY"), false);
});

test("AI blocker aliases do not depend on generated canonical keys", () => {
  const blockingInputs = publicDeployTaskBlockingInputs(
    [
      {
        id: "configuration-2",
        key: "configuration-2",
        label: "Port",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        type: "env",
      },
      {
        id: "_API_KEY",
        key: "_API_KEY",
        label: "API key",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(
    blockingInputs.map((input) => input.key),
    ["configuration-1", "configuration-2"]
  );
});

test("stamped AI plan and blocker metadata cannot publish unknown secrets", () => {
  const unknownSecret = "repo-secret-marker";
  const summary = publicDeployTaskArtifactSummary(
    {
      deploymentPlan: {
        inputs: [
          {
            description: unknownSecret,
            key: unknownSecret,
            label: unknownSecret,
            options: [unknownSecret],
            required: true,
            type: unknownSecret,
          },
        ],
        kind: "sealos-template",
        missingInputKeys: [unknownSecret],
        templateName: unknownSecret,
      },
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );
  const blockingInputs = publicDeployTaskBlockingInputs(
    [
      {
        description: unknownSecret,
        id: unknownSecret,
        key: unknownSecret,
        label: unknownSecret,
        options: [unknownSecret],
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        type: "text",
        valueType: unknownSecret,
      },
    ],
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(summary, {
    deploymentPlan: {
      inputs: [
        {
          key: "configuration-1",
          label: "Configuration value",
          required: true,
          sensitive: true,
          type: "secret",
        },
      ],
      kind: "sealos-template",
      missingInputKeys: ["configuration-1"],
      templateName: "deployment",
    },
  });
  assert.deepEqual(blockingInputs, [
    {
      id: "configuration-1",
      key: "configuration-1",
      label: "Configuration value",
      required: true,
      sensitive: true,
      type: "secret",
    },
  ]);
  assert.equal(
    JSON.stringify({ blockingInputs, summary }).includes(unknownSecret),
    false
  );
});

test("trusted public AI timeline strips output summaries from every dedupe key", () => {
  const legacySecret = "legacy-timeline-secret";
  const outputPartialDedupeKey = `deployment_task.output_partial:${JSON.stringify(
    { build: { token: legacySecret } }
  )}`;
  const outputReadyDedupeKey = `deployment_task.output_ready:${JSON.stringify({
    deliveryManifest: { apiKey: legacySecret },
  })}`;
  const timeline = {
    publicProjectionVersion: CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
    revision: 3,
    status: "running",
    steps: [
      {
        events: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            dedupeKey: outputPartialDedupeKey,
            id: "step-output",
            message: legacySecret,
            unknown: legacySecret,
          },
          {
            createdAt: "2026-07-23T00:00:02.000Z",
            dedupeKey: "deployment_task.output_partial:second-signature",
            id: "step-output-latest",
            message: legacySecret,
            unknown: legacySecret,
          },
        ],
        id: "generate-deployment",
        label: "Generate deployment",
        order: 0,
        resultCards: [
          {
            events: [
              {
                createdAt: "2026-07-23T00:00:01.000Z",
                dedupeKey: outputReadyDedupeKey,
                id: "card-output",
                message: legacySecret,
                unknown: legacySecret,
              },
            ],
            id: legacySecret,
            latestStatusText: legacySecret,
            required: true,
            resultRef: { kind: "AP", name: "demo", namespace: "ns-demo" },
            status: "running",
            title: legacySecret,
            unknown: legacySecret,
          },
        ],
        status: "running",
      },
    ],
    taskId: "task-ai",
    updatedAt: "2026-07-23T00:00:01.000Z",
  } as unknown as DeploymentTaskTimelineSnapshot;

  const projected = publicDeployTaskTimelineSnapshot(timeline, {
    runner: { kind: "ai", runtimeProvider: "devbox" },
  });

  assert.equal(
    projected?.steps[0]?.events[0]?.dedupeKey,
    "deployment_task.output_partial"
  );
  assert.equal(projected?.steps[0]?.events.length, 1);
  assert.equal(
    projected?.steps[0]?.events[0]?.createdAt,
    "2026-07-23T00:00:02.000Z"
  );
  assert.equal(
    projected?.steps[0]?.resultCards?.[0]?.events[0]?.dedupeKey,
    "deployment_task.output_ready"
  );
  assert.equal(
    projected?.steps[0]?.events[0]?.message,
    "Deployment output files are partially available."
  );
  assert.equal(projected?.steps[0]?.label, "Generate deployment");
  assert.equal(projected?.steps[0]?.resultCards?.[0]?.title, "Application");
  assert.equal(
    projected?.steps[0]?.resultCards?.[0]?.latestStatusText,
    "Running"
  );
  assert.equal(JSON.stringify(projected).includes(legacySecret), false);
  assert.equal(timeline.steps[0]?.events[0]?.dedupeKey, outputPartialDedupeKey);
});

test("public AI timeline shows allowlisted progress and omits unknown events", () => {
  const privateText = "private-timeline-text";
  const timeline = {
    publicProjectionVersion: CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
    revision: 4,
    status: "running",
    steps: [
      {
        events: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            dedupeKey: "deployment_task.prepare_started",
            id: "prepare-started",
            message: privateText,
          },
          {
            createdAt: "2026-07-23T00:00:01.000Z",
            dedupeKey: "unknown-private-event",
            id: "unknown-event",
            message: privateText,
          },
          {
            createdAt: "2026-07-23T00:00:02.000Z",
            dedupeKey: "deployment_task.workspace_ready",
            id: "workspace-ready",
            message: privateText,
          },
        ],
        id: "prepare-workspace",
        label: privateText,
        order: 99,
        status: "completed",
      },
    ],
    taskId: "task-ai",
    updatedAt: "2026-07-23T00:00:02.000Z",
  } as unknown as DeploymentTaskTimelineSnapshot;

  const projected = publicDeployTaskTimelineSnapshot(timeline, {
    runner: { kind: "ai", runtimeProvider: "devbox" },
  });

  assert.deepEqual(
    projected?.steps[0]?.events.map(({ dedupeKey, message }) => ({
      dedupeKey,
      message,
    })),
    [
      {
        dedupeKey: "deployment_task.prepare_started",
        message: "Preparing deployment.",
      },
      {
        dedupeKey: "deployment_task.workspace_ready",
        message: "Deployment workspace is ready.",
      },
    ]
  );
  assert.equal(JSON.stringify(projected).includes(privateText), false);
  assert.equal(
    JSON.stringify(projected).includes("Deployment progress updated."),
    false
  );
});

test("legacy public AI timeline hides result references", () => {
  const legacySecret = "abc";
  const timeline = {
    revision: 1,
    status: "running",
    steps: [
      {
        events: [],
        id: "create-resources",
        label: legacySecret,
        order: 3,
        resultCards: [
          {
            events: [],
            id: legacySecret,
            required: true,
            resultRef: {
              kind: "AP",
              name: legacySecret,
              namespace: "ns-demo",
            },
            status: "running",
            title: legacySecret,
          },
        ],
        status: "running",
      },
    ],
    taskId: "task-ai",
    updatedAt: "2026-07-23T00:00:00.000Z",
  } as unknown as DeploymentTaskTimelineSnapshot;

  const projected = publicDeployTaskTimelineSnapshot(timeline, {
    runner: { kind: "ai", runtimeProvider: "devbox" },
  });

  assert.equal(projected?.steps[0]?.resultCards, undefined);
  assert.equal(JSON.stringify(projected).includes(legacySecret), false);
});

test("public AI timeline rebuilds legacy failure events without raw text", () => {
  const legacySecret = "legacy-readiness-provider-secret";
  const timeline = {
    revision: 7,
    status: "failed",
    steps: [
      {
        events: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            dedupeKey: "deployment-task-terminal-failure",
            id: legacySecret,
            message: legacySecret,
            reason: legacySecret,
          },
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            dedupeKey: legacySecret,
            id: legacySecret,
            message: legacySecret,
          },
        ],
        id: "create-resources",
        label: legacySecret,
        order: 99,
        status: "failed",
      },
      {
        events: [],
        id: legacySecret,
        label: legacySecret,
        order: 100,
        status: "running",
      },
    ],
    taskId: "task-ai",
    updatedAt: "2026-07-23T00:00:00.000Z",
  } as unknown as DeploymentTaskTimelineSnapshot;

  const projected = publicDeployTaskTimelineSnapshot(timeline, {
    failureReason: "readiness-timeout",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    taskId: "task-ai",
  });

  assert.equal(projected?.steps.length, 1);
  assert.equal(projected?.steps[0]?.order, 3);
  assert.equal(
    projected?.steps[0]?.events[0]?.message,
    "Deployment resources didn't become ready in time. Created resources were preserved — Redeploy reuses them."
  );
  assert.equal(projected?.steps[0]?.events.length, 1);
  assert.equal(JSON.stringify(projected).includes(legacySecret), false);
});

test("public AI timeline rebuilds runner failure events from task failure details", () => {
  const timeline = {
    publicProjectionVersion: CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
    revision: 7,
    status: "failed",
    steps: [
      {
        events: [
          {
            createdAt: "2026-07-23T00:00:00.000Z",
            dedupeKey: "deployment_task.failed",
            id: "runner-failure",
            message: "untrusted failure text",
            reason: "DeploymentTaskFailed",
            severity: "error",
            source: "runner",
          },
        ],
        id: "analyze-source",
        label: "Analyze source",
        order: 1,
        status: "failed",
      },
    ],
    taskId: "task-ai",
    updatedAt: "2026-07-23T00:00:00.000Z",
  } satisfies DeploymentTaskTimelineSnapshot;

  const projected = publicDeployTaskTimelineSnapshot(timeline, {
    failureReason: "gateway-timeout",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    taskId: "task-ai",
  });

  assert.deepEqual(projected?.steps[0]?.events[0], {
    createdAt: "2026-07-23T00:00:00.000Z",
    dedupeKey: "deployment-task-terminal-failure",
    id: "analyze-source-event-0",
    message: "Repository analysis timed out. Redeploy to try again.",
    reason: "DeploymentTaskFailed",
    severity: "error",
    source: "runner",
  });
});

test("public timeline leaves non-AI snapshots unchanged", () => {
  const timeline = {
    revision: 1,
    status: "running",
    steps: [],
    taskId: "task-direct",
    updatedAt: "2026-07-23T00:00:00.000Z",
  } satisfies DeploymentTaskTimelineSnapshot;

  assert.equal(
    publicDeployTaskTimelineSnapshot(timeline, {
      runner: { kind: "direct" },
    }),
    timeline
  );
});

test("public event payload redacts nested artifact summary", () => {
  const payload = publicDeployTaskEventPayload(
    {
      artifactSummary: TEMPLATE_SUMMARY,
      note: "applied",
    },
    { runner: { kind: "direct" } }
  );

  assert.equal(payload.note, "applied");
  assert.deepEqual(payload.artifactSummary, {
    buildResult: TEMPLATE_SUMMARY.buildResult,
    deploymentPlan: {
      args: { mode: "demo" },
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
  });
});

test("public AI event fields rebuild kind and message from allowlisted data", () => {
  const legacySecret = "legacy-event-message-secret";
  const failed = publicDeployTaskEventFields(
    {
      kind: "deployment_task.failed",
      message: legacySecret,
      payload: { error: legacySecret, reason: "gateway-timeout" },
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );
  const unknown = publicDeployTaskEventFields(
    {
      kind: `deployment_task.${legacySecret}`,
      message: legacySecret,
      payload: { token: legacySecret },
    },
    { runner: { kind: "ai", runtimeProvider: "devbox" } }
  );

  assert.deepEqual(failed, {
    kind: "deployment_task.failed",
    message: "Repository analysis timed out. Redeploy to try again.",
    payload: { reason: "gateway-timeout" },
  });
  assert.deepEqual(unknown, {
    kind: "deployment_task.event",
    message: null,
    payload: {},
  });
  assert.equal(
    JSON.stringify({ failed, unknown }).includes(legacySecret),
    false
  );
});

test("public AI task metadata hides gateway transcript locators", () => {
  const locator = {
    gatewaySessionId: "session-private",
    gatewayTurnId: "turn-private",
    gatewayUrl: "https://gateway.example.test?token=private",
  };

  assert.deepEqual(
    publicDeployTaskGatewayLocator(locator, {
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }),
    {
      gatewaySessionId: null,
      gatewayTurnId: null,
      gatewayUrl: null,
    }
  );
  assert.equal(
    publicDeployTaskGatewayLocator(locator, {
      runner: { kind: "direct" },
    }),
    locator
  );
  assert.deepEqual(
    publicDeployTaskRuntimeLocator(
      {
        runtimeName: "devbox-private-locator",
        runtimeState: "Bearer private-runtime-state",
      },
      { runner: { kind: "ai", runtimeProvider: "devbox" } }
    ),
    { runtimeName: null, runtimeState: null }
  );
});

test("public AI failed event exposes only a validated failure reason", () => {
  const payload = publicDeployTaskEventPayload(
    {
      detail: "Bearer private-detail-token",
      error: "Bearer private-token",
      image_ref: "registry.example.com/demo:private-token",
      nested: [{ secret: "private-array-token" }],
      reason: "gateway-upstream-error",
    },
    {
      eventKind: "deployment_task.failed",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, { reason: "gateway-upstream-error" });
  assert.equal(JSON.stringify(payload).includes("private"), false);
});

test("public AI failed event rejects an unknown failure reason", () => {
  const payload = publicDeployTaskEventPayload(
    {
      detail: "Bearer private-token",
      reason: "invented-failure-reason",
    },
    {
      eventKind: "deployment_task.failed",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});

test("public AI output event exposes only boolean progress", () => {
  const payload = publicDeployTaskEventPayload(
    {
      build: {
        image_ref: "registry.example.com/demo:private-token",
      },
      complete: false,
      detail: "Bearer private-detail-token",
      files: {
        buildResult: true,
        deliveryManifest: false,
        template: false,
      },
      nested: [{ secret: "private-array-token" }],
    },
    {
      eventKind: "deployment_task.output_partial",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {
    complete: false,
    files: {
      buildResult: true,
      deliveryManifest: false,
      template: false,
    },
  });
  assert.equal(JSON.stringify(payload).includes("private"), false);
});

test("public AI output event rejects malformed progress", () => {
  const payload = publicDeployTaskEventPayload(
    {
      complete: "false",
      files: {
        buildResult: true,
        deliveryManifest: false,
        template: false,
      },
    },
    {
      eventKind: "deployment_task.output_partial",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});

test("public AI ready event exposes complete boolean progress", () => {
  const payload = publicDeployTaskEventPayload(
    {
      complete: true,
      files: {
        buildResult: true,
        deliveryManifest: true,
        template: true,
      },
      image_ref: "registry.example.com/demo:private-token",
    },
    {
      eventKind: "deployment_task.output_ready",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {
    complete: true,
    files: {
      buildResult: true,
      deliveryManifest: true,
      template: true,
    },
  });
});

test("public AI engine verdict exposes only validated enums", () => {
  const payload = publicDeployTaskEventPayload(
    {
      detail: "Bearer private-detail-token",
      image_ref: "registry.example.com/demo:private-token",
      nested: [{ secret: "private-array-token" }],
      reason: "timeout",
      verdict: "failed",
    },
    {
      eventKind: "deployment_task.engine_resolved",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, { reason: "timeout", verdict: "failed" });
  assert.equal(JSON.stringify(payload).includes("private"), false);
});

test("public AI engine verdict accepts known cancellation resolutions", () => {
  const payload = publicDeployTaskEventPayload(
    {
      reason: "cancel-ack-deadline",
      verdict: "cancelled",
    },
    {
      eventKind: "deployment_task.engine_resolved",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {
    reason: "cancel-ack-deadline",
    verdict: "cancelled",
  });
});

test("public AI engine verdict rejects unknown enums", () => {
  const payload = publicDeployTaskEventPayload(
    {
      reason: "timeout",
      verdict: "completed",
    },
    {
      eventKind: "deployment_task.engine_resolved",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});

test("public AI gateway event payloads fail closed", () => {
  const payload = publicDeployTaskEventPayload(
    { arbitrary: { message: "Bearer private-token" }, state: "ready" },
    {
      eventKind: "deploy_task.gateway_state",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});

test("unknown public AI event payloads fail closed", () => {
  const payload = publicDeployTaskEventPayload(
    {
      detail: "Bearer private-detail-token",
      image_ref: "registry.example.com/demo:private-token",
      nested: [{ secret: "private-array-token" }],
    },
    {
      eventKind: "deployment_task.future_event",
      runner: { kind: "ai", runtimeProvider: "devbox" },
    }
  );

  assert.deepEqual(payload, {});
});

test("direct runner event payloads retain their existing projection", () => {
  const original = {
    detail: "already scrubbed detail",
    image_ref: "registry.example.com/demo:public",
    nested: [{ status: "ready" }],
  };

  assert.deepEqual(
    publicDeployTaskEventPayload(original, {
      eventKind: "deployment_task.future_event",
      runner: { kind: "direct" },
    }),
    original
  );
});
