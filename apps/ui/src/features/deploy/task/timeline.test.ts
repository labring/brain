import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DeploymentResultResourceCard,
  DeploymentTaskSuccessAttachment,
} from "./timeline";
import {
  appendCardEvent,
  appendStepEvent,
  applyDeploymentOutputProgressToTimeline,
  applyResultResourceTimeout,
  attachDeploymentTaskSuccess,
  createDeploymentTaskTimeline,
  createDeploymentTaskTimelineForRunner,
  declareTimelineSteps,
  deploymentTaskSuccessFromResultReadiness,
  deploymentTaskSuccessFromTimeline,
  deploymentTimelineFailureStepId,
  deploymentTimelineResultReadinessReached,
  deploymentTimelineStepsForRunner,
  markTimelineStep,
  upsertResultResourceCard,
} from "./timeline";

const NOW = "2026-06-17T10:00:00.000Z";

test("direct deployment runner declares stable user-facing timeline steps", () => {
  assert.deepEqual(deploymentTimelineStepsForRunner({ kind: "direct" }), [
    { id: "validate-settings", label: "Validate settings", order: 0 },
    { id: "create-resources", label: "Create resources", order: 1 },
  ]);
});

test("AI deployment timelines use source-specific analysis language", () => {
  const githubTimeline = createDeploymentTaskTimelineForRunner({
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: {
      kind: "github",
      repo: {
        fullName: "acme/api",
        name: "api",
        url: "https://github.com/acme/api",
      },
    },
    status: "queued",
    taskId: "github-task",
    updatedAt: NOW,
  });
  const promptTimeline = createDeploymentTaskTimelineForRunner({
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: { kind: "prompt", text: "Deploy a small API" },
    status: "queued",
    taskId: "prompt-task",
    updatedAt: NOW,
  });

  assert.equal(githubTimeline.steps[1]?.label, "Analyze repository");
  assert.equal(promptTimeline.steps[1]?.label, "Analyze request");
});

test("deployment task failure step prefers the currently running timeline step", () => {
  const runner = { kind: "ai", runtimeProvider: "devbox" } as const;
  const timeline = createDeploymentTaskTimelineForRunner({
    runner,
    source: {
      kind: "github",
      repo: {
        fullName: "acme/api",
        name: "api",
        url: "https://github.com/acme/api",
      },
    },
    status: "running",
    taskId: "task-1",
    updatedAt: NOW,
  });
  const preparing = markTimelineStep(timeline, {
    status: "running",
    stepId: "prepare-workspace",
    updatedAt: "2026-06-17T10:00:01.000Z",
  });

  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "plan",
      runner,
      timeline: preparing,
    }),
    "prepare-workspace"
  );
});

test("deployment task failure step falls back to the runner step for the current phase", () => {
  const aiRunner = { kind: "ai", runtimeProvider: "devbox" } as const;
  const aiTimeline = createDeploymentTaskTimelineForRunner({
    runner: aiRunner,
    status: "running",
    taskId: "ai-task",
    updatedAt: NOW,
  });

  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "prepare",
      runner: aiRunner,
      timeline: aiTimeline,
    }),
    "prepare-workspace"
  );
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "plan",
      runner: aiRunner,
      timeline: aiTimeline,
    }),
    "analyze-source"
  );
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "generate-artifacts",
      runner: aiRunner,
      timeline: aiTimeline,
    }),
    "generate-deployment"
  );
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "configure",
      runner: aiRunner,
      timeline: aiTimeline,
    }),
    "generate-deployment"
  );
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "resolve-target",
      runner: aiRunner,
      timeline: aiTimeline,
    }),
    null
  );

  const templateRunner = { kind: "template" } as const;
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "generate-artifacts",
      runner: templateRunner,
      timeline: createDeploymentTaskTimelineForRunner({
        runner: templateRunner,
        status: "running",
        taskId: "template-task",
        updatedAt: NOW,
      }),
    }),
    "prepare-template"
  );
  assert.equal(
    deploymentTimelineFailureStepId({
      phase: "configure",
      runner: templateRunner,
      timeline: createDeploymentTaskTimelineForRunner({
        runner: templateRunner,
        status: "running",
        taskId: "template-task-configure",
        updatedAt: NOW,
      }),
    }),
    "prepare-template"
  );
});

test("deployment task timeline preserves runner-defined step order and revision metadata", () => {
  const timeline = createDeploymentTaskTimeline({
    status: "running",
    taskId: "task-1",
    updatedAt: NOW,
  });

  const next = declareTimelineSteps(timeline, {
    steps: [
      { id: "create-resources", label: "Create resources" },
      { id: "validate-settings", label: "Validate settings", order: 10 },
    ],
    updatedAt: "2026-06-17T10:00:01.000Z",
  });

  assert.equal(next.revision, 1);
  assert.equal(next.updatedAt, "2026-06-17T10:00:01.000Z");
  assert.deepEqual(
    next.steps.map((step) => ({
      id: step.id,
      label: step.label,
      order: step.order,
      status: step.status,
    })),
    [
      {
        id: "create-resources",
        label: "Create resources",
        order: 0,
        status: "pending",
      },
      {
        id: "validate-settings",
        label: "Validate settings",
        order: 10,
        status: "pending",
      },
    ]
  );

  const renamed = declareTimelineSteps(next, {
    steps: [{ id: "create-resources", label: "Apply stuff" }],
    updatedAt: "2026-06-17T10:00:02.000Z",
  });

  assert.equal(renamed.steps[0]?.label, "Create resources");
});

test("deployment task timeline groups step and card events with stable dedupe", () => {
  const timeline = declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: "running",
      taskId: "task-1",
      updatedAt: NOW,
    }),
    {
      steps: [{ id: "create-resources", label: "Create resources" }],
      updatedAt: NOW,
    }
  );

  const withStepEvent = appendStepEvent(timeline, {
    event: {
      createdAt: NOW,
      dedupeKey: "apply-started",
      id: "evt-1",
      message: "Applying deployment artifacts.",
      source: "runner",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });
  const withDuplicateStepEvent = appendStepEvent(withStepEvent, {
    event: {
      createdAt: NOW,
      dedupeKey: "apply-started",
      id: "evt-2",
      message: "Applying deployment artifacts again.",
      source: "runner",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });

  assert.equal(withDuplicateStepEvent.steps[0]?.events.length, 1);

  const withCard = upsertResultResourceCard(withDuplicateStepEvent, {
    card: {
      id: "AP:default:api",
      required: true,
      resultRef: { kind: "AP", name: "api", namespace: "default" },
      status: "creating",
      title: "api",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });
  const withCardEvent = appendCardEvent(withCard, {
    cardId: "AP:default:api",
    event: {
      createdAt: NOW,
      dedupeKey: "AP:default:api:progressing",
      id: "evt-3",
      message: "AP workload is progressing.",
      reason: "Progressing",
      source: "resource-observer",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });

  assert.equal(
    withCardEvent.steps[0]?.events[0]?.message,
    "Applying deployment artifacts."
  );
  assert.equal(
    withCardEvent.steps[0]?.resultCards?.[0]?.events[0]?.message,
    "AP workload is progressing."
  );
});

test("deployment output progress belongs to the AI deployment generation step", () => {
  const timeline = createDeploymentTaskTimelineForRunner({
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: {
      kind: "github",
      repo: {
        fullName: "acme/api",
        name: "api",
        url: "https://github.com/acme/api",
      },
    },
    status: "running",
    taskId: "task-1",
    updatedAt: NOW,
  });

  const withBuildOutput = applyDeploymentOutputProgressToTimeline(timeline, {
    complete: false,
    event: {
      createdAt: "2026-06-17T10:00:01.000Z",
      dedupeKey: "deployment_task.output_partial:build",
      id: "evt-1",
      message: "Deployment output files are partially available.",
      source: "runner",
    },
    updatedAt: "2026-06-17T10:00:01.000Z",
  });
  const withManifestOutput = applyDeploymentOutputProgressToTimeline(
    withBuildOutput,
    {
      complete: false,
      event: {
        createdAt: "2026-06-17T10:00:02.000Z",
        dedupeKey: "deployment_task.output_partial:manifest",
        id: "evt-2",
        message: "Deployment output files are partially available.",
        source: "runner",
      },
      updatedAt: "2026-06-17T10:00:02.000Z",
    }
  );
  const withDuplicateManifestOutput = applyDeploymentOutputProgressToTimeline(
    withManifestOutput,
    {
      complete: false,
      event: {
        createdAt: "2026-06-17T10:00:03.000Z",
        dedupeKey: "deployment_task.output_partial:manifest",
        id: "evt-3",
        message: "Deployment output files are partially available.",
        source: "runner",
      },
      updatedAt: "2026-06-17T10:00:03.000Z",
    }
  );
  const withReadyOutput = applyDeploymentOutputProgressToTimeline(
    withDuplicateManifestOutput,
    {
      complete: true,
      event: {
        createdAt: "2026-06-17T10:00:04.000Z",
        dedupeKey: "deployment_task.output_ready:ready",
        id: "evt-4",
        message: "Deployment output files are ready.",
        source: "runner",
      },
      updatedAt: "2026-06-17T10:00:04.000Z",
    }
  );

  const generationStep = withReadyOutput.steps.find(
    (step) => step.id === "generate-deployment"
  );

  assert.equal(generationStep?.status, "completed");
  assert.deepEqual(
    generationStep?.events.map((event) => event.dedupeKey),
    [
      "deployment_task.output_partial:build",
      "deployment_task.output_partial:manifest",
      "deployment_task.output_ready:ready",
    ]
  );
  assert.equal(
    withReadyOutput.steps.find((step) => step.id === "analyze-source")?.events
      .length,
    0
  );
});

test("required result cards determine deployment result readiness", () => {
  const timeline = declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: "running",
      taskId: "task-1",
      updatedAt: NOW,
    }),
    {
      steps: [{ id: "create-resources", label: "Create resources" }],
      updatedAt: NOW,
    }
  );

  const creating = upsertResultResourceCard(timeline, {
    card: {
      id: "AP:default:api",
      required: true,
      resultRef: { kind: "AP", name: "api", namespace: "default" },
      status: "creating",
      title: "api",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });
  assert.equal(deploymentTimelineResultReadinessReached(creating), false);

  const optionalUnknown = upsertResultResourceCard(creating, {
    card: {
      id: "PublicAccess:default:api:platform",
      required: false,
      resultRef: {
        apName: "api",
        id: "platform",
        kind: "PublicAccess",
        namespace: "default",
      },
      status: "unknown",
      title: "Public access",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });
  const running = upsertResultResourceCard(optionalUnknown, {
    card: {
      id: "AP:default:api",
      required: true,
      resultRef: { kind: "AP", name: "api", namespace: "default" },
      status: "running",
      title: "api",
    },
    stepId: "create-resources",
    updatedAt: NOW,
  });

  assert.equal(deploymentTimelineResultReadinessReached(running), true);
});

test("optional result card timeout records warning without failing the timeline", () => {
  const timeline = upsertResultResourceCard(
    declareTimelineSteps(
      createDeploymentTaskTimeline({
        status: "applying",
        taskId: "task-1",
        updatedAt: NOW,
      }),
      {
        steps: [{ id: "create-resources", label: "Create resources" }],
        updatedAt: NOW,
      }
    ),
    {
      card: {
        id: "PublicAccess:default:api:pa_api",
        required: false,
        resultRef: {
          apName: "api",
          id: "pa_api",
          kind: "PublicAccess",
          namespace: "default",
        },
        status: "creating",
        title: "Public access",
      },
      stepId: "create-resources",
      updatedAt: NOW,
    }
  );

  const timedOut = applyResultResourceTimeout(timeline, {
    cardId: "PublicAccess:default:api:pa_api",
    lastObservedStatus: "progressing",
    stepId: "create-resources",
    updatedAt: "2026-06-17T10:00:05.000Z",
  });

  const card = timedOut.steps[0]?.resultCards?.[0];
  assert.equal(timedOut.status, "applying");
  assert.equal(card?.status, "unknown");
  assert.equal(card?.latestStatusText, "progressing");
  assert.deepEqual(card?.events[0], {
    createdAt: "2026-06-17T10:00:05.000Z",
    dedupeKey: "PublicAccess:default:api:pa_api:timeout",
    id: "PublicAccess:default:api:pa_api:timeout",
    message: "Result resource timed out while optional: progressing.",
    reason: "ResourceReadinessTimeout",
    severity: "warning",
    source: "resource-observer",
  });
});

test("required result card timeout fails the timeline with last observed status", () => {
  const timeline = upsertResultResourceCard(
    declareTimelineSteps(
      createDeploymentTaskTimeline({
        status: "applying",
        taskId: "task-1",
        updatedAt: NOW,
      }),
      {
        steps: [{ id: "create-resources", label: "Create resources" }],
        updatedAt: NOW,
      }
    ),
    {
      card: {
        id: "DB:default:postgres",
        required: true,
        resultRef: { kind: "DB", name: "postgres", namespace: "default" },
        status: "creating",
        title: "postgres",
      },
      stepId: "create-resources",
      updatedAt: NOW,
    }
  );

  const timedOut = applyResultResourceTimeout(timeline, {
    cardId: "DB:default:postgres",
    lastObservedStatus: "Creating",
    stepId: "create-resources",
    updatedAt: "2026-06-17T10:00:06.000Z",
  });

  const card = timedOut.steps[0]?.resultCards?.[0];
  assert.equal(timedOut.status, "failed");
  assert.equal(card?.status, "failed");
  assert.equal(card?.latestStatusText, "Creating");
  assert.equal(card?.events[0]?.severity, "error");
});

test("required result card timeout can preserve the timeline for template resources", () => {
  const timeline = upsertResultResourceCard(
    declareTimelineSteps(
      createDeploymentTaskTimeline({
        status: "applying",
        taskId: "task-1",
        updatedAt: NOW,
      }),
      {
        steps: [{ id: "create-resources", label: "Create resources" }],
        updatedAt: NOW,
      }
    ),
    {
      card: {
        id: "TemplateWorkload:default:StatefulSet:dify-api",
        required: true,
        resultRef: {
          kind: "TemplateWorkload",
          name: "dify-api",
          namespace: "default",
          workloadKind: "StatefulSet",
        },
        status: "creating",
        title: "dify-api",
      },
      stepId: "create-resources",
      updatedAt: NOW,
    }
  );

  const timedOut = applyResultResourceTimeout(timeline, {
    cardId: "TemplateWorkload:default:StatefulSet:dify-api",
    failRequired: false,
    lastObservedStatus: "Progressing, 0/1 replicas ready",
    stepId: "create-resources",
    updatedAt: "2026-06-17T10:00:07.000Z",
  });

  const card = timedOut.steps[0]?.resultCards?.[0];
  assert.equal(timedOut.status, "applying");
  assert.equal(card?.status, "unknown");
  assert.equal(card?.latestStatusText, "Progressing, 0/1 replicas ready");
  assert.equal(card?.events[0]?.severity, "warning");
});

test("marking a step updates only the matching runner step", () => {
  const timeline = declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: "running",
      taskId: "task-1",
      updatedAt: NOW,
    }),
    {
      steps: [
        { id: "validate-settings", label: "Validate settings" },
        { id: "create-resources", label: "Create resources" },
      ],
      updatedAt: NOW,
    }
  );

  const next = markTimelineStep(timeline, {
    status: "running",
    stepId: "create-resources",
    updatedAt: "2026-06-17T10:00:03.000Z",
  });

  assert.deepEqual(
    next.steps.map((step) => [step.id, step.status]),
    [
      ["validate-settings", "pending"],
      ["create-resources", "running"],
    ]
  );
  assert.equal(next.revision, 2);
});

function emptyTimeline(taskId = "task-1") {
  return declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: "applying",
      taskId,
      updatedAt: NOW,
    }),
    {
      steps: [
        { id: "validate-settings", label: "Validate settings" },
        { id: "create-resources", label: "Create resources" },
      ],
      updatedAt: NOW,
    }
  );
}

const EAGLERCRAFT_SUCCESS = {
  entries: [
    { label: "Server address", url: "https://mc.mock.sealos.run" },
    { url: "https://console.mock.sealos.run" },
  ],
  guidance: [
    {
      detail: "Use the EaglerCraft-compatible client.",
      label: "Open the client",
    },
    { label: "Enter the server address" },
  ],
  openActionLabel: "Open server address",
  productId: "eaglercraft-server",
  productName: "EaglerCraft Server",
  verification: { passed: 3, total: 3 },
  verifiedAt: "2026-06-17T10:00:05.000Z",
};

test("readiness with no required result resource claims nothing", () => {
  // A task can complete without a single required result resource: nothing
  // reached the running state, so "you can start using it" would be a claim
  // with no evidence behind it.
  assert.equal(
    deploymentTaskSuccessFromResultReadiness({
      productName: "Site",
      requiredRunningCards: 0,
    }),
    null
  );
});

test("readiness claims exactly the required resources it saw running", () => {
  assert.deepEqual(
    deploymentTaskSuccessFromResultReadiness({
      productName: "Site",
      requiredRunningCards: 2,
    }),
    { productName: "Site", verification: { passed: 2, total: 2 } }
  );
});

test("a readiness claim never drops its verification count", () => {
  const success = deploymentTaskSuccessFromResultReadiness({
    productName: null,
    requiredRunningCards: 3,
  });
  assert.deepEqual(success, { verification: { passed: 3, total: 3 } });

  const next = attachDeploymentTaskSuccess(emptyTimeline(), {
    success,
    updatedAt: "2026-06-17T10:00:06.000Z",
  });
  assert.equal(next.success?.productName, undefined);
  assert.deepEqual(next.success?.verification, { passed: 3, total: 3 });
});

const EAGLERCRAFT_WORKLOAD_CARD: DeploymentResultResourceCard = {
  events: [],
  id: "AP:default:eaglercraft",
  required: true,
  resultRef: { kind: "AP", name: "eaglercraft", namespace: "default" },
  status: "creating",
  title: "eaglercraft",
};

const EAGLERCRAFT_PROBE_CARD: DeploymentResultResourceCard = {
  events: [],
  id: "PublicAccess:default:eaglercraft:lobby",
  required: true,
  resultRef: {
    apName: "eaglercraft",
    id: "lobby",
    kind: "PublicAccess",
    namespace: "default",
  },
  status: "creating",
  title: "Public access",
};

/**
 * The three frames a deployment really passes through, asserted at the
 * snapshot seam the runner reads from: the claim may only appear once every
 * required result resource — the entry probe included — is running in the same
 * Timeline the user is watching.
 */
function timelineFrame(statusByCard: Record<string, "creating" | "running">) {
  let timeline = declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: "applying",
      taskId: "task-eaglercraft",
      updatedAt: NOW,
    }),
    {
      steps: [{ id: "create-resources", label: "Create resources" }],
      updatedAt: NOW,
    }
  );
  for (const card of [EAGLERCRAFT_WORKLOAD_CARD, EAGLERCRAFT_PROBE_CARD]) {
    timeline = upsertResultResourceCard(timeline, {
      card: { ...card, status: statusByCard[card.id] ?? "creating" },
      stepId: "create-resources",
      updatedAt: NOW,
    });
  }
  return timeline;
}

test("a running workload with a pending probe is not yet a usable product", () => {
  const deploying = timelineFrame({});
  assert.equal(
    deploymentTaskSuccessFromTimeline(deploying, { productName: null }),
    null
  );

  const workloadReady = timelineFrame({
    "AP:default:eaglercraft": "running",
  });
  assert.equal(deploymentTimelineResultReadinessReached(workloadReady), false);
  assert.equal(
    deploymentTaskSuccessFromTimeline(workloadReady, {
      productName: "EaglerCraft Server",
    }),
    null
  );
});

test("the claim published with the probe covers exactly what is on screen", () => {
  const verified = timelineFrame({
    "AP:default:eaglercraft": "running",
    "PublicAccess:default:eaglercraft:lobby": "running",
  });
  const visibleRequiredCards = verified.steps
    .flatMap((step) => step.resultCards ?? [])
    .filter((card) => card.required).length;

  const success = deploymentTaskSuccessFromTimeline(verified, {
    productName: "EaglerCraft Server",
  });
  assert.deepEqual(success, {
    productName: "EaglerCraft Server",
    verification: { passed: visibleRequiredCards, total: visibleRequiredCards },
  });

  assert.ok(success, "a fully verified timeline publishes a claim");
  const next = attachDeploymentTaskSuccess(verified, {
    success,
    updatedAt: "2026-06-17T10:00:06.000Z",
  });
  assert.equal(next.success?.verification?.passed, 2);
  assert.equal(next.revision, verified.revision + 1);
  // The evidence stays on screen underneath the conclusion.
  assert.equal(next.steps[0]?.resultCards?.length, 2);
});

test("a verified template Ingress becomes the Public domain success entry", () => {
  const publicDomainCard: DeploymentResultResourceCard = {
    events: [],
    id: "TemplatePublicAccess:default:affine:https://affine.example.sealos.run",
    required: true,
    resultRef: {
      kind: "TemplatePublicAccess",
      name: "affine",
      namespace: "default",
      url: "https://affine.example.sealos.run",
    },
    status: "running",
    title: "Public domain",
  };
  const timeline = upsertResultResourceCard(
    timelineFrame({
      "AP:default:eaglercraft": "running",
      "PublicAccess:default:eaglercraft:lobby": "running",
    }),
    {
      card: publicDomainCard,
      stepId: "create-resources",
      updatedAt: NOW,
    }
  );

  assert.deepEqual(
    deploymentTaskSuccessFromTimeline(timeline, { productName: "AFFiNE" }),
    {
      entries: [
        {
          label: "Public domain",
          url: "https://affine.example.sealos.run",
        },
      ],
      productName: "AFFiNE",
      verification: { passed: 3, total: 3 },
    }
  );
});

test("a timeline with no required result resource publishes no claim", () => {
  const optional = upsertResultResourceCard(
    declareTimelineSteps(
      createDeploymentTaskTimeline({
        status: "applying",
        taskId: "task-optional",
        updatedAt: NOW,
      }),
      {
        steps: [{ id: "create-resources", label: "Create resources" }],
        updatedAt: NOW,
      }
    ),
    {
      card: {
        id: "AP:default:sidekiq",
        required: false,
        resultRef: { kind: "AP", name: "sidekiq", namespace: "default" },
        status: "running",
        title: "sidekiq",
      },
      stepId: "create-resources",
      updatedAt: NOW,
    }
  );
  assert.equal(
    deploymentTaskSuccessFromTimeline(optional, { productName: "Web app" }),
    null
  );
});

test("attaching success stamps the timeline revision it was recorded at", () => {
  const timeline = emptyTimeline();
  assert.equal(timeline.revision, 1);

  const next = attachDeploymentTaskSuccess(timeline, {
    success: EAGLERCRAFT_SUCCESS,
    updatedAt: "2026-06-17T10:00:06.000Z",
  });

  assert.equal(next.revision, 2);
  assert.equal(next.success?.revision, 2);
  assert.equal(next.success?.contractVersion, 1);
  assert.equal(next.success?.productName, "EaglerCraft Server");
  assert.deepEqual(next.success?.entries, [
    { label: "Server address", url: "https://mc.mock.sealos.run" },
    { url: "https://console.mock.sealos.run" },
  ]);
  assert.equal(next.success?.verifiedAt, "2026-06-17T10:00:05.000Z");
  // The internal evidence is untouched: success is appended, not substituted.
  assert.deepEqual(
    next.steps.map((step) => step.id),
    ["validate-settings", "create-resources"]
  );
});

test("attaching success falls back to the write time when no stamp is given", () => {
  const next = attachDeploymentTaskSuccess(emptyTimeline(), {
    success: { productName: "Web app" },
    updatedAt: "2026-06-17T11:00:00.000Z",
  });
  assert.equal(next.success?.verifiedAt, "2026-06-17T11:00:00.000Z");
});

test("re-attaching the same success conclusion does not churn the revision", () => {
  const timeline = emptyTimeline();
  const first = attachDeploymentTaskSuccess(timeline, {
    success: EAGLERCRAFT_SUCCESS,
    updatedAt: "2026-06-17T10:00:06.000Z",
  });
  const second = attachDeploymentTaskSuccess(first, {
    success: EAGLERCRAFT_SUCCESS,
    updatedAt: "2026-06-17T10:00:09.000Z",
  });

  assert.equal(second, first);
  assert.equal(second.revision, first.revision);
  assert.equal(second.success?.revision, first.success?.revision);
});

test("a materially different success conclusion gets a fresh revision", () => {
  const first = attachDeploymentTaskSuccess(emptyTimeline(), {
    success: { productName: "Web app", verification: { passed: 1, total: 2 } },
    updatedAt: "2026-06-17T10:00:06.000Z",
  });
  const second = attachDeploymentTaskSuccess(first, {
    success: { productName: "Web app", verification: { passed: 2, total: 2 } },
    updatedAt: "2026-06-17T10:00:08.000Z",
  });

  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.success?.revision, second.revision);
  assert.deepEqual(second.success?.verification, { passed: 2, total: 2 });
});

test("success sanitisation drops undisplayable content instead of rendering it", () => {
  const next = attachDeploymentTaskSuccess(emptyTimeline(), {
    success: {
      entries: [
        { label: "  ", url: "  https://mc.mock.sealos.run  " },
        { label: "Database", url: "postgres://user:pw@db:5432" },
        { label: "Gopher", url: "not a url" },
        { url: 42 },
      ],
      guidance: ["", "Open the client", { detail: "  ", label: " Join " }],
      headline: "   ",
      productName: null,
      verification: { passed: 5, total: 3 },
    } as unknown as DeploymentTaskSuccessAttachment,
    updatedAt: "2026-06-17T10:00:06.000Z",
  });

  assert.deepEqual(next.success?.entries, [
    { url: "https://mc.mock.sealos.run" },
  ]);
  assert.deepEqual(next.success?.guidance, [
    { label: "Open the client" },
    { label: "Join" },
  ]);
  assert.equal(next.success?.headline, undefined);
  assert.equal(next.success?.productName, undefined);
  assert.equal(next.success?.verification, undefined);
});

test("non-object success records are rejected outright", () => {
  const timeline = emptyTimeline();
  for (const value of [null, undefined, "completed", 7, []]) {
    assert.equal(
      attachDeploymentTaskSuccess(timeline, {
        success: value as unknown as DeploymentTaskSuccessAttachment,
        updatedAt: "2026-06-17T10:00:06.000Z",
      }),
      timeline
    );
  }
});

test("a long contract headline is bounded so the card stays presentable", () => {
  const next = attachDeploymentTaskSuccess(emptyTimeline(), {
    success: { headline: "x".repeat(400) },
    updatedAt: "2026-06-17T10:00:06.000Z",
  });
  assert.equal(next.success?.headline?.length, 140);
  assert.ok(next.success?.headline?.endsWith("\u2026"));
});
