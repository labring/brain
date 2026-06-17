import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendCardEvent,
  appendStepEvent,
  createDeploymentTaskTimeline,
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
