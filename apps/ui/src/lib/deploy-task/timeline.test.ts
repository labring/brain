import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendCardEvent,
  appendStepEvent,
  applyResultResourceTimeout,
  createDeploymentTaskTimeline,
  createDeploymentTaskTimelineForRunner,
  declareTimelineSteps,
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
