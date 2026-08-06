import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { and, eq } from "drizzle-orm";

import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "@/features/marketing/schema";

import { deploymentFailureMessage } from "../failure-summary";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
  deployTaskEvents,
  deployTasks,
} from "../schema";
import { appendStepEvent } from "../timeline";
import {
  cancelDeployTaskAction,
  createDeployTaskAction,
  submitDeployTaskInputAction,
} from "./actions";
import type { DeployTaskEngineCadence } from "./constants";
import { DEPLOY_TASK_ENGINE_CADENCE } from "./constants";
import type {
  DeployTaskEngineContext,
  DeployTaskEngineDevbox,
} from "./context";
import {
  DeployTaskRunCancelledError,
  DeployTaskRunTimeoutError,
} from "./errors";
import { runDeployTaskReaperSweep } from "./reaper";
import {
  getActiveDeployTaskHandle,
  stopDeployTaskEngineRuntimeForTests,
} from "./runtime";
import { insertTaskRow } from "./testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "./testing/harness";
import {
  appendDeployTaskEvent,
  recordDeployTaskCancelRequest,
  renewDeployTaskLease,
  transitionDeployTask,
} from "./transitions";

let harness: DeployTaskTestHarness;

const ILLEGAL_TRANSITION_RE = /Illegal deploy task transition/;
const EMPTY_BLOCKING_INPUTS_RE = /cannot enter blocked without blocking inputs/;

interface RecordingDevbox extends DeployTaskEngineDevbox {
  deleted: string[];
  failNextDelete: boolean;
  paused: string[];
}

function recordingDevbox(): RecordingDevbox {
  const state: RecordingDevbox = {
    deleted: [],
    failNextDelete: false,
    paused: [],
    deleteDevbox(namespace, name) {
      if (state.failNextDelete) {
        state.failNextDelete = false;
        return Promise.reject(new Error("devbox delete unavailable"));
      }
      state.deleted.push(`${namespace}/${name}`);
      return Promise.resolve("deleted" as const);
    },
    pauseDevbox(namespace, name) {
      state.paused.push(`${namespace}/${name}`);
      return Promise.resolve("paused" as const);
    },
  };
  return state;
}

let devbox: RecordingDevbox;

function testCtx(
  cadence: Partial<DeployTaskEngineCadence> = {}
): DeployTaskEngineContext {
  return {
    cadence: { ...DEPLOY_TASK_ENGINE_CADENCE, ...cadence },
    db: harness.db as unknown as DeployTaskEngineContext["db"],
    devbox,
    notify: harness.notify,
    processId: "test-proc",
  };
}

before(async () => {
  harness = await createDeployTaskTestHarness();
});

after(async () => {
  await harness.close();
});

afterEach(() => {
  stopDeployTaskEngineRuntimeForTests();
  devbox = recordingDevbox();
});

before(() => {
  devbox = recordingDevbox();
});

async function taskById(taskId: string) {
  const [row] = await harness.db
    .select()
    .from(deployTasks)
    .where(eq(deployTasks.id, taskId))
    .limit(1);
  assert.ok(row, `task ${taskId} should exist`);
  return row;
}

async function eventsFor(taskId: string) {
  return await harness.db
    .select()
    .from(deployTaskEvents)
    .where(eq(deployTaskEvents.taskId, taskId))
    .orderBy(deployTaskEvents.seq);
}

test("claim transition grants the lease, bumps the epoch, records the event", async () => {
  const ctx = testCtx();
  const row = await insertTaskRow(harness.db, { status: "queued" });

  const claim = await transitionDeployTask(ctx, {
    event: { kind: "deployment_task.started", message: "started", payload: {} },
    from: ["queued"],
    lease: "claim",
    set: { phase: "prepare" },
    taskId: row.id,
    to: "running",
  });

  assert.ok(claim);
  assert.equal(claim.status, "running");
  assert.equal(claim.leaseEpoch, 1);

  const stored = await taskById(row.id);
  assert.equal(stored.status, "running");
  assert.equal(stored.leaseOwner, "test-proc");
  assert.equal(stored.leaseEpoch, 1);
  assert.ok(stored.leaseExpiresAt != null);
  assert.ok(stored.startedAt != null);
  assert.equal(stored.phase, "prepare");

  const events = await eventsFor(row.id);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, "deployment_task.started");
});

test("transitions reject illegal moves and stale statuses", async () => {
  const ctx = testCtx();
  const row = await insertTaskRow(harness.db, { status: "completed" });

  await assert.rejects(
    transitionDeployTask(ctx, {
      from: ["completed"],
      taskId: row.id,
      to: "running",
    } as never),
    ILLEGAL_TRANSITION_RE
  );

  const lost = await transitionDeployTask(ctx, {
    from: ["running"],
    taskId: row.id,
    to: "failed",
    set: { error: "x" },
  });
  assert.equal(lost, null);
  assert.equal((await taskById(row.id)).status, "completed");
});

test("the status writer rejects blocked transitions without inputs", async () => {
  const ctx = testCtx();
  const row = await insertTaskRow(harness.db, {
    leaseEpoch: 1,
    leaseOwner: "test-proc",
    status: "running",
  });

  await assert.rejects(
    transitionDeployTask(ctx, {
      expectedLeaseEpoch: 1,
      from: ["running"],
      set: { blockingInputs: [], phase: "configure" },
      taskId: row.id,
      to: "blocked",
    }),
    EMPTY_BLOCKING_INPUTS_RE
  );

  assert.equal((await taskById(row.id)).status, "running");
  assert.equal((await eventsFor(row.id)).length, 0);
});

test("stale lease epoch fences writes to no-ops", async () => {
  const ctx = testCtx();
  const row = await insertTaskRow(harness.db, {
    leaseEpoch: 2,
    leaseOwner: "test-proc",
    status: "running",
  });

  const fenced = await transitionDeployTask(ctx, {
    expectedLeaseEpoch: 1,
    from: ["running", "applying"],
    set: { error: "stale writer" },
    taskId: row.id,
    to: "failed",
  });
  assert.equal(fenced, null);

  const fencedEvent = await appendDeployTaskEvent(ctx, {
    event: { kind: "stale.event", payload: {} },
    expectedLeaseEpoch: 1,
    from: ["running", "applying", "blocked", "queued"],
    taskId: row.id,
  });
  assert.equal(fencedEvent, null);
  assert.equal((await eventsFor(row.id)).length, 0);
  assert.equal((await taskById(row.id)).status, "running");
});

test("lease renewal is fenced by epoch, owner, and status", async () => {
  const ctx = testCtx();
  const row = await insertTaskRow(harness.db, {
    leaseEpoch: 1,
    leaseOwner: "test-proc",
    status: "running",
  });

  const renewed = await renewDeployTaskLease(ctx, {
    expectedLeaseEpoch: 1,
    taskId: row.id,
  });
  assert.ok(renewed);

  const staleEpoch = await renewDeployTaskLease(ctx, {
    expectedLeaseEpoch: 2,
    taskId: row.id,
  });
  assert.equal(staleEpoch, null);

  await harness.db
    .update(deployTasks)
    .set({ status: "failed", completedAt: new Date() })
    .where(eq(deployTasks.id, row.id));
  const terminal = await renewDeployTaskLease(ctx, {
    expectedLeaseEpoch: 1,
    taskId: row.id,
  });
  assert.equal(terminal, null);
});

test("reaper resolves expired leases: interrupted, or cancelled when intent pends", async () => {
  const ctx = testCtx();
  const past = new Date(Date.now() - 5000);
  const interrupted = await insertTaskRow(harness.db, {
    leaseClaimedAt: past,
    leaseEpoch: 1,
    leaseExpiresAt: past,
    leaseOwner: "dead-proc",
    status: "running",
  });
  const cancelledPending = await insertTaskRow(harness.db, {
    cancelRequestedAt: past,
    leaseClaimedAt: past,
    leaseEpoch: 1,
    leaseExpiresAt: past,
    leaseOwner: "dead-proc",
    status: "applying",
  });
  const alive = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(),
    leaseEpoch: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: "live-proc",
    status: "running",
  });

  const summary = await runDeployTaskReaperSweep(ctx);
  assert.equal(summary.interrupted, 1);
  assert.ok(summary.interruptedWithCancel + summary.cancelAckForced >= 1);

  const interruptedRow = await taskById(interrupted.id);
  assert.equal(interruptedRow.status, "failed");
  assert.equal(
    (interruptedRow.failureDetails as { reason?: string } | null)?.reason,
    "interrupted"
  );
  assert.equal(interruptedRow.error, deploymentFailureMessage("interrupted"));
  assert.ok(interruptedRow.completedAt != null);

  const cancelledRow = await taskById(cancelledPending.id);
  assert.equal(cancelledRow.status, "cancelled");

  assert.equal((await taskById(alive.id)).status, "running");

  const verdictEvents = await eventsFor(interrupted.id);
  assert.equal(verdictEvents.length, 1);
  assert.equal(verdictEvents[0]?.kind, "deployment_task.engine_resolved");
  assert.equal(
    verdictEvents[0]?.message,
    deploymentFailureMessage("interrupted")
  );
});

test("reaper enforces cancel-ack deadline, max active run, and start deadline", async () => {
  const ctx = testCtx();
  const now = Date.now();
  const liveLease = new Date(now + 60_000);

  const unackedCancel = await insertTaskRow(harness.db, {
    cancelRequestedAt: new Date(now - 120_000),
    leaseClaimedAt: new Date(now - 200_000),
    leaseEpoch: 3,
    leaseExpiresAt: liveLease,
    leaseOwner: "live-proc",
    status: "running",
  });
  const overrun = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(now - 71 * 60_000),
    leaseEpoch: 1,
    leaseExpiresAt: new Date(now - 1000),
    leaseOwner: "live-proc",
    status: "applying",
  });
  const neverStarted = await insertTaskRow(harness.db, {
    createdAt: new Date(now - 10 * 60_000),
    status: "queued",
  });

  const summary = await runDeployTaskReaperSweep(ctx);
  assert.equal(summary.cancelAckForced, 1);
  assert.equal(summary.timedOut, 1);
  assert.equal(summary.neverStarted, 1);

  assert.equal((await taskById(unackedCancel.id)).status, "cancelled");
  const overrunRow = await taskById(overrun.id);
  assert.equal(overrunRow.status, "failed");
  assert.equal(
    (overrunRow.failureDetails as { reason?: string } | null)?.reason,
    "timeout"
  );
  assert.equal(overrunRow.error, deploymentFailureMessage("timeout"));
  const neverRow = await taskById(neverStarted.id);
  assert.equal(neverRow.status, "failed");
  assert.equal(
    (neverRow.failureDetails as { reason?: string } | null)?.reason,
    "never-started"
  );
  assert.equal(neverRow.error, deploymentFailureMessage("never-started"));

  // The forced cancel starves the still-live runner's writes.
  const starved = await transitionDeployTask(ctx, {
    expectedLeaseEpoch: 3,
    from: ["running", "applying"],
    taskId: unackedCancel.id,
    to: "completed",
  } as never).catch(() => null);
  assert.equal(starved, null);
});

test("reaper fails invalid blocked tasks and preserves trusted input waits", async () => {
  const ctx = testCtx();
  const unknown = await insertTaskRow(harness.db, {
    blockingInputs: [],
    phase: "plan",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    runtimeName: "deploy-invalid-blocked",
    runtimeProvider: "devbox",
    runtimeState: "running",
    status: "blocked",
  });
  const outputMissing = await insertTaskRow(harness.db, { status: "blocked" });
  const buildRuntime = await insertTaskRow(harness.db, { status: "blocked" });
  const gateway = await insertTaskRow(harness.db, { status: "blocked" });
  const legacyAi = await insertTaskRow(harness.db, {
    blockingInputs: [
      {
        id: "internal-port",
        key: "PORT",
        label: "Port",
        required: true,
        type: "text",
      },
    ],
    phase: "configure",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  const validTemplate = await insertTaskRow(harness.db, {
    blockingInputs: [
      { id: "port", key: "PORT", label: "Port", required: true, type: "text" },
    ],
    phase: "configure",
    status: "blocked",
  });
  const validAi = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      { id: "PORT", key: "PORT", label: "Port", required: true, type: "text" },
    ],
    phase: "configure",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });

  for (const [taskId, kind] of [
    [outputMissing.id, "deployment_task.output_missing"],
    [buildRuntime.id, "deployment_task.build_runtime_unavailable"],
    [gateway.id, "deployment_task.gateway_unavailable"],
  ] as const) {
    await appendDeployTaskEvent(ctx, {
      event: { kind, message: "legacy failure", payload: {} },
      from: ["blocked"],
      taskId,
    });
  }

  const summary = await runDeployTaskReaperSweep(ctx);

  assert.equal(summary.invalidBlocked, 5);
  assert.equal(summary.devboxPaused, 1);
  const unknownRow = await taskById(unknown.id);
  assert.equal(unknownRow.status, "failed");
  assert.equal(unknownRow.runtimeState, "paused");
  assert.equal(unknownRow.error, deploymentFailureMessage("unknown"));
  assert.deepEqual(unknownRow.failureDetails, {
    detail: "empty-blocking-inputs",
    failureMessage: deploymentFailureMessage("unknown"),
    reason: "unknown",
  });
  assert.equal((await taskById(validTemplate.id)).status, "blocked");
  assert.equal((await taskById(validAi.id)).status, "blocked");
  const legacyAiRow = await taskById(legacyAi.id);
  assert.equal(legacyAiRow.status, "failed");
  assert.deepEqual(legacyAiRow.failureDetails, {
    detail: "untrusted-ai-blocking-inputs",
    failureMessage: deploymentFailureMessage("unknown"),
    reason: "unknown",
  });

  const [unknownEvent] = await eventsFor(unknown.id);
  assert.equal(unknownEvent?.kind, "deployment_task.engine_resolved");
  assert.deepEqual(unknownEvent?.payload, {
    detail: "empty-blocking-inputs",
    reason: "unknown",
    verdict: "failed",
  });

  for (const [taskId, reason] of [
    [outputMissing.id, "deployment-output-missing"],
    [buildRuntime.id, "build-runtime-unavailable"],
    [gateway.id, "gateway-not-exposed"],
  ] as const) {
    const row = await taskById(taskId);
    assert.equal(row.status, "failed");
    assert.equal(row.error, deploymentFailureMessage(reason));
    assert.equal(
      (row.failureDetails as { reason?: string } | null)?.reason,
      reason
    );
    const verdict = (await eventsFor(taskId)).at(-1);
    assert.equal(verdict?.kind, "deployment_task.engine_resolved");
    assert.equal(verdict?.payload.reason, reason);
  }

  const repeat = await runDeployTaskReaperSweep(ctx);
  assert.equal(repeat.invalidBlocked, 0);
});

test("create action inserts, claims inline, launches, and completes through the handle", async () => {
  const ctx = testCtx();
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      await handle.emitEvent({ kind: "runner.progress", payload: {} });
      await handle.beginApplying();
      await handle.complete();
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  assert.ok(result.launched);
  await result.launched?.done;

  const stored = await taskById(result.task.id);
  assert.equal(stored.status, "completed");
  assert.equal(stored.leaseOwner, null);
  assert.ok(stored.completedAt != null);

  const kinds = (await eventsFor(result.task.id)).map((event) => event.kind);
  assert.deepEqual(kinds, [
    "deploy_task.created",
    "deployment_task.started",
    "runner.progress",
    "deployment_task.completed",
  ]);
});

test("deployment transitions persist attribution and enqueue lifecycle events", async () => {
  const ctx = testCtx();
  const touch = {
    campaign: "us-deploy-intent",
    channel: "paid_search",
    click_id_type: "gclid" as const,
    click_id_value: "test-gclid-123",
    content: "repo-to-url",
    landing_hostname: "sealos.io",
    landing_path: "/",
    medium: "paid",
    source: "google",
    term: "deploy github repo",
    ts: "2026-08-06T08:00:00.000Z",
  };
  const result = await createDeployTaskAction(ctx, {
    create: {
      creatingActor: "marketing-test-user",
      marketingAttribution: {
        ad_user_data_consent: true,
        first_touch: touch,
        gbraid: null,
        gclid: "test-gclid-123",
        last_touch: touch,
        version: 2,
        wbraid: null,
      },
      namespace: "marketing-test-workspace",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "marketing-demo" },
      target: { kind: "existingProject", projectId: "marketing-project" },
    },
    run: async (handle) => {
      await handle.beginApplying();
      await handle.complete();
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  await result.launched?.done;

  const lifecycleEvents = await harness.db
    .select()
    .from(marketingLifecycleEvents)
    .where(eq(marketingLifecycleEvents.deploymentId, result.task.id))
    .orderBy(marketingLifecycleEvents.occurredAt);
  assert.deepEqual(
    lifecycleEvents.map((event) => event.eventName),
    ["build_started", "deploy_success"]
  );
  assert.equal(lifecycleEvents[0]?.gclid, "test-gclid-123");
  assert.equal(lifecycleEvents[0]?.adUserDataConsent, "granted");

  const subjects = await harness.db
    .select()
    .from(marketingAttributionSubjects)
    .where(
      and(
        eq(marketingAttributionSubjects.gclid, "test-gclid-123"),
        eq(marketingAttributionSubjects.adUserDataConsent, "granted")
      )
    );
  assert.deepEqual(
    subjects
      .map((subject) => `${subject.subjectType}:${subject.subjectId}`)
      .sort(),
    ["user:marketing-test-user", "workspace:marketing-test-workspace"]
  );
});

test("payment transaction IDs deduplicate across lifecycle events", async () => {
  const payment = {
    adUserDataConsent: "denied" as const,
    currency: "USD",
    deploymentId: null,
    eventName: "topup_success" as const,
    firstTouch: null,
    gbraid: null,
    gclid: null,
    lastTouch: null,
    occurredAt: new Date("2026-08-06T09:00:00.000Z"),
    transactionId: "payment-deduplication-test",
    userId: "payment-test-user",
    value: "20.000000",
    wbraid: null,
    workspaceId: "payment-test-workspace",
  };
  const first = await harness.db
    .insert(marketingLifecycleEvents)
    .values({ ...payment, eventId: "payment-deduplication-event-1" })
    .onConflictDoNothing()
    .returning({ eventId: marketingLifecycleEvents.eventId });
  const duplicate = await harness.db
    .insert(marketingLifecycleEvents)
    .values({ ...payment, eventId: "payment-deduplication-event-2" })
    .onConflictDoNothing()
    .returning({ eventId: marketingLifecycleEvents.eventId });

  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 0);
  const rows = await harness.db
    .select()
    .from(marketingLifecycleEvents)
    .where(
      eq(marketingLifecycleEvents.transactionId, "payment-deduplication-test")
    );
  assert.equal(rows.length, 1);
});

test("AI timeline persistence keeps event identity and dedupe semantics", async () => {
  const ctx = testCtx();
  let beforeStamp: number | undefined;
  let afterStamp: number | undefined;
  let persistedEvents: Array<{ dedupeKey?: string; id: string }> = [];
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "ai", runtimeProvider: "devbox" },
      source: { kind: "prompt", text: "deploy demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      const unstampedTimeline = (await taskById(handle.taskId))
        .timelineSnapshot;
      assert.ok(unstampedTimeline);
      beforeStamp = unstampedTimeline.publicProjectionVersion;
      const event = {
        createdAt: "2026-06-17T10:00:05.000Z",
        dedupeKey: "deployment_task.output_partial:same-signature",
        id: "timeline-event-id",
        message: "untrusted output detail",
        source: "runner" as const,
      };
      for (let index = 0; index < 2; index += 1) {
        await handle.updateTimeline({
          update: (timeline) =>
            appendStepEvent(timeline, {
              event,
              stepId: "generate-deployment",
              updatedAt: event.createdAt,
            }),
        });
      }
      const stampedTimeline = (await taskById(handle.taskId)).timelineSnapshot;
      afterStamp = stampedTimeline?.publicProjectionVersion;
      persistedEvents =
        stampedTimeline?.steps.find((step) => step.id === "generate-deployment")
          ?.events ?? [];
      await handle.beginApplying();
      await handle.complete();
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  await result.launched?.done;
  assert.equal(beforeStamp, undefined);
  assert.equal(afterStamp, CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION);
  assert.deepEqual(persistedEvents, [
    {
      createdAt: "2026-06-17T10:00:05.000Z",
      dedupeKey: "deployment_task.output_partial:same-signature",
      id: "timeline-event-id",
      message: "Deployment output files are partially available.",
      source: "runner",
    },
  ]);
});

test("requesting inputs rejects an empty wait without releasing the lease", async () => {
  const ctx = testCtx();
  let rejected = false;
  let remainedRunning = false;
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      try {
        await handle.requestInputs({ blockingInputs: [], phase: "configure" });
      } catch (error) {
        rejected =
          error instanceof Error &&
          error.message ===
            "Deployment task cannot enter blocked without blocking inputs.";
      }
      const running = await taskById(handle.taskId);
      remainedRunning =
        running.status === "running" && running.leaseOwner === "test-proc";
      await handle.beginApplying();
      await handle.complete();
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  await result.launched?.done;

  assert.equal(rejected, true);
  assert.equal(remainedRunning, true);
  assert.equal((await taskById(result.task.id)).status, "completed");
});

test("create strips sensitive template args from every persisted form (ADR 0037)", async () => {
  const ctx = testCtx();
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: {
        args: {
          DB_PASSWORD: "s3cret-value",
          custom_field: "also-s3cret",
          mode: "fast",
        },
        kind: "template",
        sensitiveKeys: ["custom_field"],
        templateName: "demo",
      },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async () => {
      /* runner does not advance in this test */
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  const stored = await taskById(result.task.id);
  const source = stored.source as {
    args?: Record<string, string>;
    sensitiveKeys?: string[];
  };
  assert.deepEqual(source.args, { mode: "fast" });
  // Every stripped key is recorded (names only) so clones know what to
  // re-ask — client-declared and heuristic-matched alike.
  assert.deepEqual(source.sensitiveKeys, ["DB_PASSWORD", "custom_field"]);

  const persisted = JSON.stringify({
    events: await eventsFor(result.task.id),
    stored,
  });
  assert.ok(!persisted.includes("s3cret-value"));
  assert.ok(!persisted.includes("also-s3cret"));
});

test("clone validation matrix: not-found, conflict on active/completed, unique race", async () => {
  const ctx = testCtx();
  const run = async () => {
    /* runner never advances in this test */
  };
  const create = {
    namespace: "ns-test",
    runner: { kind: "template" },
    source: { kind: "template", templateName: "demo" },
    target: { kind: "existingProject", projectId: "project-test" },
  } as const;

  const missing = await createDeployTaskAction(ctx, {
    create,
    predecessorTaskId: "task-that-never-existed",
    run,
  });
  assert.equal(missing.kind, "predecessor-not-found");

  const active = await insertTaskRow(harness.db, { status: "running" });
  const activeConflict = await createDeployTaskAction(ctx, {
    create,
    predecessorTaskId: active.id,
    run,
  });
  assert.equal(activeConflict.kind, "predecessor-conflict");

  const completed = await insertTaskRow(harness.db, {
    completedAt: new Date(),
    status: "completed",
  });
  const completedConflict = await createDeployTaskAction(ctx, {
    create,
    predecessorTaskId: completed.id,
    run,
  });
  assert.equal(completedConflict.kind, "predecessor-conflict");

  const failed = await insertTaskRow(harness.db, {
    artifactSummary: {
      resultIdentities: { templateInstanceName: "demo-abc123" },
    },
    completedAt: new Date(),
    status: "failed",
  });
  const cloneA = await insertTaskRow(harness.db, {
    retriedFromTaskId: failed.id,
    status: "running",
  });
  const cloneRace = await createDeployTaskAction(ctx, {
    create,
    predecessorTaskId: failed.id,
    run,
  });
  assert.equal(cloneRace.kind, "clone-conflict");
  if (cloneRace.kind === "clone-conflict") {
    assert.equal(cloneRace.activeClone?.id, cloneA.id);
  }
});

test("create action treats predecessors from another namespace as not found", async () => {
  const ctx = testCtx();
  for (const status of [
    "failed",
    "cancelled",
    "running",
    "completed",
  ] as const) {
    const predecessor = await insertTaskRow(harness.db, {
      completedAt: status === "running" ? null : new Date(),
      namespace: "namespace-a",
      source: { kind: "template", templateName: "namespace-a-source" },
      status,
    });

    const result = await createDeployTaskAction(ctx, {
      create: { namespace: "namespace-b" },
      predecessorTaskId: predecessor.id,
      run: async () => {
        /* must not launch for an inaccessible predecessor */
      },
    });

    assert.deepEqual(result, { kind: "predecessor-not-found" });
  }
});

test("an active clone in another namespace never blocks a redeploy", async () => {
  const ctx = testCtx();
  const predecessor = await insertTaskRow(harness.db, {
    completedAt: new Date(),
    namespace: "namespace-a",
    status: "failed",
  });
  // Cross-namespace lineage rows cannot be created through the API
  // (predecessor lookups are namespace-scoped); this simulates legacy or
  // hand-inserted data, which the namespace-keyed unique index tolerates
  // instead of surfacing an unresolvable conflict with a null activeClone.
  await insertTaskRow(harness.db, {
    namespace: "namespace-b",
    retriedFromTaskId: predecessor.id,
    status: "running",
  });

  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "namespace-a",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    predecessorTaskId: predecessor.id,
    run: async () => {
      /* runner does not advance in this test */
    },
  });

  assert.equal(result.kind, "created");
});

test("edited redeploy that retargets gets fresh identities", async () => {
  const ctx = testCtx();
  const failed = await insertTaskRow(harness.db, {
    artifactSummary: {
      resultIdentities: { templateInstanceName: "demo-abc123" },
    },
    completedAt: new Date(),
    status: "failed",
  });

  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "another-project" },
    },
    predecessorTaskId: failed.id,
    run: async () => {
      /* runner does not advance in this test */
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  const stored = await taskById(result.task.id);
  assert.equal(stored.retriedFromTaskId, failed.id);
  // A namespace-scoped instance name never travels to another Project.
  assert.equal(stored.artifactSummary.resultIdentities, undefined);
});

test("clone copies recorded result identities and records lineage", async () => {
  const ctx = testCtx();
  const failed = await insertTaskRow(harness.db, {
    artifactSummary: {
      resultIdentities: { templateInstanceName: "demo-abc123" },
    },
    completedAt: new Date(),
    status: "failed",
  });

  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    predecessorTaskId: failed.id,
    run: async () => {
      /* parked runner */
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  const clone = await taskById(result.task.id);
  assert.equal(clone.retriedFromTaskId, failed.id);
  assert.equal(
    clone.artifactSummary.resultIdentities?.templateInstanceName,
    "demo-abc123"
  );
});

test("cancel action: immediate on blocked, cooperative on running, idempotent, conflict on terminal", async () => {
  const ctx = testCtx();

  const blocked = await insertTaskRow(harness.db, {
    blockingInputs: [
      { id: "in-1", label: "Value", required: true, type: "text" },
    ],
    status: "blocked",
  });
  const blockedCancel = await cancelDeployTaskAction(ctx, {
    actionActor: "bob-cr",
    namespace: "ns-test",
    taskId: blocked.id,
  });
  assert.equal(blockedCancel.kind, "cancelled");
  assert.equal((await taskById(blocked.id)).status, "cancelled");
  assert.equal(
    (await eventsFor(blocked.id)).find(
      (event) => event.kind === "deployment_task.cancelled"
    )?.payload.actionActor,
    "bob-cr"
  );

  const running = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(),
    leaseEpoch: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: "other-proc",
    status: "running",
  });
  const first = await cancelDeployTaskAction(ctx, {
    actionActor: "carol-cr",
    namespace: "ns-test",
    taskId: running.id,
  });
  assert.equal(first.kind, "cancelling");
  assert.ok(
    first.kind === "cancelling" && first.task.cancelRequestedAt != null
  );

  const repeat = await cancelDeployTaskAction(ctx, {
    namespace: "ns-test",
    taskId: running.id,
  });
  assert.equal(repeat.kind, "cancelling");

  const requests = (await eventsFor(running.id)).filter(
    (event) => event.kind === "deployment_task.cancel_requested"
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.payload.actionActor, "carol-cr");

  const done = await insertTaskRow(harness.db, {
    completedAt: new Date(),
    status: "completed",
  });
  const terminal = await cancelDeployTaskAction(ctx, {
    namespace: "ns-test",
    taskId: done.id,
  });
  assert.equal(terminal.kind, "already-terminal");

  const missing = await cancelDeployTaskAction(ctx, {
    namespace: "ns-test",
    taskId: "nope",
  });
  assert.equal(missing.kind, "not-found");
});

test("cancel action treats a task from another namespace as not found", async () => {
  const ctx = testCtx();
  const task = await insertTaskRow(harness.db, {
    namespace: "namespace-a",
    status: "blocked",
  });

  const result = await cancelDeployTaskAction(ctx, {
    namespace: "namespace-b",
    taskId: task.id,
  });

  assert.deepEqual(result, { kind: "not-found" });
});

test("input submission claims blocked→running in place and hands values in memory only", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    blockingInputs: [
      {
        id: "db-password",
        key: "DB_PASSWORD",
        label: "Database password",
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    creatingActor: "alice-cr",
    credentialBinding: {
      connectionRef: "connection-alice",
      credentialOwner: "alice-cr",
      version: 1,
    },
    status: "blocked",
  });

  let received: Record<string, unknown> | null = null;
  let receivedBlockingInputs: readonly { key?: string }[] = [];
  let rejectedRunCalled = false;
  for (const values of [{}, { OTHER: "value" }, { DB_PASSWORD: null }]) {
    const rejected = await submitDeployTaskInputAction(ctx, {
      namespace: "ns-test",
      run: () => {
        rejectedRunCalled = true;
        return Promise.resolve();
      },
      taskId: blocked.id,
      values,
    });
    assert.equal(rejected.kind, "invalid-input");
  }
  assert.equal(rejectedRunCalled, false);
  assert.equal((await taskById(blocked.id)).status, "blocked");

  const shortSecret = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => Promise.resolve(),
    taskId: blocked.id,
    values: { DB_PASSWORD: "q7" },
  });
  assert.equal(shortSecret.kind, "invalid-input");
  if (shortSecret.kind === "invalid-input") {
    assert.ok(shortSecret.message.includes("at least 4 characters"));
  }

  const result = await submitDeployTaskInputAction(ctx, {
    actionActor: "bob-cr",
    namespace: "ns-test",
    run: async (handle, _task, currentBlockingInputs, submittedValues) => {
      received = submittedValues;
      receivedBlockingInputs = currentBlockingInputs;
      await handle.beginApplying();
      await handle.complete();
    },
    taskId: blocked.id,
    values: {
      "db-password": "s3cret-value",
      IGNORED_EXTRA: "must-not-reach-runner",
    },
  });

  assert.equal(result.kind, "resumed");
  if (result.kind !== "resumed") {
    return;
  }
  await result.launched.done;
  assert.deepEqual(received, { DB_PASSWORD: "s3cret-value" });
  assert.deepEqual(
    receivedBlockingInputs.map((input) => input.key),
    ["DB_PASSWORD"]
  );

  const stored = await taskById(blocked.id);
  assert.equal(stored.status, "completed");
  assert.deepEqual(stored.blockingInputs, []);
  assert.deepEqual(stored.credentialBinding, {
    connectionRef: "connection-alice",
    credentialOwner: "alice-cr",
    version: 1,
  });

  // Row-level secrets contract: the submitted value appears nowhere.
  const rowJson = JSON.stringify(stored);
  assert.ok(!rowJson.includes("s3cret-value"));
  const events = await eventsFor(blocked.id);
  assert.equal(
    events.find((event) => event.kind === "deploy_task.input_submitted")
      ?.payload.actionActor,
    "bob-cr"
  );
  const eventsJson = JSON.stringify(events);
  assert.ok(!eventsJson.includes("s3cret-value"));
  assert.ok(!eventsJson.includes("IGNORED_EXTRA"));

  const conflict = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: async () => {
      /* unreachable */
    },
    taskId: blocked.id,
    values: {},
  });
  assert.equal(conflict.kind, "conflict");
});

test("a stale blocked run cannot unregister its resumed successor", async () => {
  const ctx = testCtx();
  let releaseOldRun!: () => void;
  let releaseResumedRun!: () => void;
  let blockedReady!: () => void;
  let resumedReady!: () => void;
  const oldRunGate = new Promise<void>((resolve) => {
    releaseOldRun = resolve;
  });
  const resumedRunGate = new Promise<void>((resolve) => {
    releaseResumedRun = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    blockedReady = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    resumedReady = resolve;
  });

  const created = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      await handle.requestInputs({
        blockingInputs: [
          {
            id: "release-name",
            label: "Release name",
            required: true,
            type: "text",
          },
        ],
      });
      blockedReady();
      await oldRunGate;
    },
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") {
    return;
  }
  await blocked;

  const resumedResult = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: async (handle) => {
      resumedReady();
      await resumedRunGate;
      await handle.beginApplying();
      await handle.complete();
    },
    taskId: created.task.id,
    values: { "release-name": "stable" },
  });
  assert.equal(resumedResult.kind, "resumed");
  if (resumedResult.kind !== "resumed") {
    return;
  }
  await resumed;

  releaseOldRun();
  await created.launched?.done;
  assert.equal(
    getActiveDeployTaskHandle(created.task.id),
    resumedResult.launched.handle
  );

  releaseResumedRun();
  await resumedResult.launched.done;
  assert.equal((await taskById(created.task.id)).status, "completed");
});

test("partial required input submission stays blocked without launching", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      {
        id: "PORT",
        key: "PORT",
        label: "Port",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        type: "env",
      },
      {
        id: "API_KEY",
        key: "API_KEY",
        label: "API key",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let runCalled = false;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => {
      runCalled = true;
      return Promise.resolve();
    },
    taskId: blocked.id,
    values: { PORT: "8080" },
  });

  assert.equal(result.kind, "invalid-input");
  assert.equal(
    result.kind === "invalid-input" && result.message,
    "Submit every required deployment input."
  );
  assert.equal(runCalled, false);
  const stored = await taskById(blocked.id);
  assert.equal(stored.status, "blocked");
  assert.deepEqual(stored.blockingInputs, blocked.blockingInputs);
  assert.equal(
    (await eventsFor(blocked.id)).some(
      (event) => event.kind === "deploy_task.input_submitted"
    ),
    false
  );
});

test("one AI public identifier cannot satisfy two required blockers", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      {
        id: "PORT",
        key: "PORT",
        label: "Port",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        type: "env",
      },
      {
        id: "configuration-1",
        key: "configuration-1",
        label: "API key",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let runCalled = false;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => {
      runCalled = true;
      return Promise.resolve();
    },
    taskId: blocked.id,
    values: { "configuration-1": "one-value-only" },
  });

  assert.equal(result.kind, "invalid-input");
  assert.equal(runCalled, false);
  assert.equal((await taskById(blocked.id)).status, "blocked");
});

test("trusted AI canonical keys bind each value without aliases", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      {
        id: "internal-port-field",
        key: "PORT",
        label: "Port",
        required: true,
        type: "env",
      },
      {
        id: "internal-password-field",
        key: "PASSWORD",
        label: "Password",
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let received: Record<string, unknown> | null = null;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: async (handle, _task, _currentBlockingInputs, submittedValues) => {
      received = submittedValues;
      await handle.beginApplying();
      await handle.complete();
    },
    taskId: blocked.id,
    values: {
      PASSWORD: "secret-value",
      PORT: "8080",
    },
  });

  assert.equal(result.kind, "resumed");
  if (result.kind !== "resumed") {
    return;
  }
  await result.launched.done;
  assert.deepEqual(received, {
    PASSWORD: "secret-value",
    PORT: "8080",
  });
});

test("trusted AI submissions reject unpublished internal blocker ids", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      {
        id: "internal-port-field",
        key: "PORT",
        label: "Port",
        required: true,
        type: "env",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let runCalled = false;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => {
      runCalled = true;
      return Promise.resolve();
    },
    taskId: blocked.id,
    values: { "internal-port-field": "8080" },
  });

  assert.equal(result.kind, "invalid-input");
  assert.equal(runCalled, false);
  assert.equal((await taskById(blocked.id)).status, "blocked");
});

test("legacy AI blockers with duplicate canonical keys cannot resume", async () => {
  const ctx = testCtx();
  const blocked = await insertTaskRow(harness.db, {
    blockingInputs: [
      {
        id: "shared",
        key: "shared",
        label: "Port",
        required: true,
        type: "env",
      },
      {
        id: "shared-secret",
        key: "shared",
        label: "Password",
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let runCalled = false;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => {
      runCalled = true;
      return Promise.resolve();
    },
    taskId: blocked.id,
    values: {
      "configuration-1": "8080",
      "configuration-2": "secret-value",
    },
  });

  assert.equal(result.kind, "invalid-input");
  assert.equal(runCalled, false);
  assert.equal((await taskById(blocked.id)).status, "blocked");
});

test("legacy untrusted AI blocking inputs cannot resume", async () => {
  const ctx = testCtx();
  const legacySecretKey = "abc";
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {},
    blockingInputs: [
      {
        id: legacySecretKey,
        key: legacySecretKey,
        label: legacySecretKey,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let runCalled = false;
  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: () => {
      runCalled = true;
      return Promise.resolve();
    },
    taskId: blocked.id,
    values: { [legacySecretKey]: "submitted-secret" },
  });

  assert.equal(result.kind, "invalid-input");
  assert.equal(
    result.kind === "invalid-input" && result.message,
    "Deployment inputs are unavailable. Redeploy to try again."
  );
  assert.equal(runCalled, false);
  assert.equal((await taskById(blocked.id)).status, "blocked");
});

test("current AI inputs submit canonical identifiers outside the public grammar", async () => {
  const ctx = testCtx();
  const canonicalKey = "_API_KEY";
  const blocked = await insertTaskRow(harness.db, {
    artifactSummary: {
      publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    },
    blockingInputs: [
      {
        id: canonicalKey,
        key: canonicalKey,
        label: "API key",
        publicProjectionVersion:
          CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "blocked",
  });
  let received: Record<string, unknown> | null = null;

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: async (handle, _task, currentBlockingInputs, submittedValues) => {
      received = submittedValues;
      assert.equal(currentBlockingInputs[0]?.key, canonicalKey);
      await handle.beginApplying();
      await handle.complete();
    },
    taskId: blocked.id,
    values: { [canonicalKey]: "submitted-secret" },
  });

  assert.equal(result.kind, "resumed");
  if (result.kind !== "resumed") {
    return;
  }
  await result.launched.done;
  assert.deepEqual(received, { [canonicalKey]: "submitted-secret" });
  const inputEvent = (await eventsFor(blocked.id)).find(
    (event) => event.kind === "deploy_task.input_submitted"
  );
  assert.deepEqual(inputEvent?.payload.inputKeys, [canonicalKey]);
});

test("input action treats a task from another namespace as not found", async () => {
  const ctx = testCtx();
  const task = await insertTaskRow(harness.db, {
    blockingInputs: [
      {
        id: "db-password",
        key: "DB_PASSWORD",
        label: "Database password",
        required: true,
        sensitive: true,
        type: "secret",
      },
    ],
    namespace: "namespace-a",
    status: "blocked",
  });

  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "namespace-b",
    run: async () => {
      /* must not launch for an inaccessible task */
    },
    taskId: task.id,
    values: { DB_PASSWORD: "namespace-b-value" },
  });

  assert.deepEqual(result, { kind: "not-found" });
});

test("launched run acknowledges cancel as a typed outcome, never failure", async () => {
  const ctx = testCtx({ leaseRenewIntervalMs: 40 });

  let sawAbort = false;
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      // Simulate a long integration call that honors the abort signal.
      await new Promise<void>((resolve, reject) => {
        if (handle.signal.aborted) {
          reject(new DeployTaskRunCancelledError());
          return;
        }
        const timer = setTimeout(resolve, 5000);
        handle.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          sawAbort = true;
          reject(new DeployTaskRunCancelledError());
        });
      });
      await handle.complete();
    },
  });

  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }
  const cancelResult = await cancelDeployTaskAction(ctx, {
    namespace: "ns-test",
    taskId: result.task.id,
  });
  assert.ok(
    cancelResult.kind === "cancelling" || cancelResult.kind === "cancelled"
  );
  await result.launched?.done;

  assert.ok(sawAbort);
  const stored = await taskById(result.task.id);
  assert.equal(stored.status, "cancelled");
  assert.ok(stored.completedAt != null);
});

test("local watchdog resolves a live run at the active execution deadline", async () => {
  const ctx = testCtx({
    leaseRenewIntervalMs: 20,
    maxActiveRunMs: 60,
  });

  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      await new Promise<void>((_resolve, reject) => {
        handle.signal.addEventListener(
          "abort",
          () => reject(handle.signal.reason),
          { once: true }
        );
      });
    },
  });
  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }

  await result.launched?.done;
  const stored = await taskById(result.task.id);
  assert.equal(stored.status, "failed");
  assert.equal(
    (stored.failureDetails as { reason?: string } | null)?.reason,
    "timeout"
  );
});

test("local watchdog stops the runner before a slow timeout transition completes", async () => {
  const baseCtx = testCtx({
    leaseRenewIntervalMs: 10_000,
    maxActiveRunMs: 100,
  });
  let delayExecute = false;
  let releaseExecute!: () => void;
  const executeGate = new Promise<void>((resolve) => {
    releaseExecute = resolve;
  });
  const originalExecute = baseCtx.db.execute.bind(baseCtx.db);
  const delayedExecute = (async (...args: unknown[]) => {
    if (delayExecute) {
      await executeGate;
    }
    return await originalExecute(...(args as [never]));
  }) as typeof baseCtx.db.execute;
  const delayedDb = new Proxy(baseCtx.db, {
    get(target, property) {
      if (property === "execute") {
        return delayedExecute;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const ctx: DeployTaskEngineContext = {
    ...baseCtx,
    db: delayedDb,
  };

  let observeAbort!: (reason: unknown) => void;
  const abortObserved = new Promise<unknown>((resolve) => {
    observeAbort = resolve;
  });
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      await new Promise<void>((_resolve, reject) => {
        handle.signal.addEventListener(
          "abort",
          () => {
            observeAbort(handle.signal.reason);
            reject(handle.signal.reason);
          },
          { once: true }
        );
      });
    },
  });
  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }

  delayExecute = true;
  let abortGuardTimer: ReturnType<typeof setTimeout> | undefined;
  const abortReason = await Promise.race([
    abortObserved,
    new Promise<never>((_resolve, reject) => {
      abortGuardTimer = setTimeout(
        () => reject(new Error("watchdog did not abort before transition")),
        1000
      );
    }),
  ]);
  clearTimeout(abortGuardTimer);
  assert.ok(abortReason instanceof DeployTaskRunTimeoutError);
  assert.equal((await taskById(result.task.id)).status, "running");

  releaseExecute();
  await result.launched?.done;
  const stored = await taskById(result.task.id);
  assert.equal(stored.status, "failed");
  assert.equal(
    (stored.failureDetails as { reason?: string } | null)?.reason,
    "timeout"
  );
});

test("local watchdog gives an already-persisted cancel intent precedence", async () => {
  const ctx = testCtx({
    leaseRenewIntervalMs: 10_000,
    maxActiveRunMs: 100,
  });
  let abortReason: unknown;
  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      await new Promise<void>((_resolve, reject) => {
        handle.signal.addEventListener(
          "abort",
          () => {
            abortReason = handle.signal.reason;
            reject(handle.signal.reason);
          },
          { once: true }
        );
      });
    },
  });
  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }

  const recorded = await recordDeployTaskCancelRequest(ctx, {
    taskId: result.task.id,
  });
  assert.ok(recorded?.cancelRequestedAt != null);
  await result.launched?.done;

  assert.ok(abortReason instanceof DeployTaskRunTimeoutError);
  const stored = await taskById(result.task.id);
  assert.equal(stored.status, "cancelled");
  assert.equal(
    (stored.failureDetails as { detail?: string } | null)?.detail,
    "cancel-requested-at-deadline"
  );
});

test("deadline transition CAS defines cancel-versus-timeout boundary priority", async () => {
  const ctx = testCtx();
  const cancelFirst = await insertTaskRow(harness.db, {
    cancelRequestedAt: new Date(),
    leaseClaimedAt: new Date(),
    leaseEpoch: 3,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: ctx.processId,
    status: "running",
  });
  const timeoutBlocked = await transitionDeployTask(ctx, {
    cancelRequest: "absent",
    expectedLeaseEpoch: 3,
    from: ["running"],
    taskId: cancelFirst.id,
    to: "failed",
  });
  assert.equal(timeoutBlocked, null);
  const cancelled = await transitionDeployTask(ctx, {
    cancelRequest: "present",
    expectedLeaseEpoch: 3,
    from: ["running"],
    taskId: cancelFirst.id,
    to: "cancelled",
  });
  assert.ok(cancelled != null);

  const timeoutFirst = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(),
    leaseEpoch: 4,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: ctx.processId,
    status: "running",
  });
  const timedOut = await transitionDeployTask(ctx, {
    cancelRequest: "absent",
    expectedLeaseEpoch: 4,
    from: ["running"],
    taskId: timeoutFirst.id,
    to: "failed",
  });
  assert.ok(timedOut != null);
  assert.equal(
    await recordDeployTaskCancelRequest(ctx, { taskId: timeoutFirst.id }),
    null
  );

  const boundary = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(),
    leaseEpoch: 5,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: ctx.processId,
    status: "running",
  });
  const [boundaryTimeout, boundaryCancel] = await Promise.all([
    transitionDeployTask(ctx, {
      cancelRequest: "absent",
      expectedLeaseEpoch: 5,
      from: ["running"],
      taskId: boundary.id,
      to: "failed",
    }),
    recordDeployTaskCancelRequest(ctx, { taskId: boundary.id }),
  ]);
  if (boundaryCancel == null) {
    assert.ok(boundaryTimeout != null);
    assert.equal((await taskById(boundary.id)).status, "failed");
  } else {
    assert.equal(boundaryTimeout, null);
    assert.ok(
      await transitionDeployTask(ctx, {
        cancelRequest: "present",
        expectedLeaseEpoch: 5,
        from: ["running"],
        taskId: boundary.id,
        to: "cancelled",
      })
    );
    assert.equal((await taskById(boundary.id)).status, "cancelled");
  }
});

test("reaper pauses devboxes of terminal tasks and purges after retention", async () => {
  const ctx = testCtx({ retentionMs: 60_000 });

  const failedWithDevbox = await insertTaskRow(harness.db, {
    completedAt: new Date(Date.now() - 1000),
    runtimeName: "devbox-a",
    runtimeProvider: "devbox",
    runtimeState: "Running",
    status: "failed",
  });
  const purgeDue = await insertTaskRow(harness.db, {
    completedAt: new Date(Date.now() - 120_000),
    runtimeName: "devbox-b",
    runtimeProvider: "devbox",
    runtimeState: "paused",
    status: "cancelled",
  });

  const purgeEvents: string[] = [];
  const unsubscribe = await harness.notify.subscribe((event) => {
    if (event.kind === "purge") {
      purgeEvents.push(event.taskId);
    }
  });

  const summary = await runDeployTaskReaperSweep(ctx);
  assert.ok(summary.devboxPaused >= 1);
  assert.equal(summary.purged, 1);

  assert.ok(devbox.paused.includes("ns-test/devbox-a"));
  assert.equal((await taskById(failedWithDevbox.id)).runtimeState, "paused");

  assert.ok(devbox.deleted.includes("ns-test/devbox-b"));
  const [purgedRow] = await harness.db
    .select({ id: deployTasks.id })
    .from(deployTasks)
    .where(eq(deployTasks.id, purgeDue.id));
  assert.equal(purgedRow, undefined);

  await new Promise((resolve) => setTimeout(resolve, 50));
  await unsubscribe();
  assert.deepEqual(purgeEvents, [purgeDue.id]);
});

test("timer renewal keeps a slow integration alive across lease expiry", async () => {
  const ctx = testCtx({
    leaseDurationMs: 150,
    leaseRenewIntervalMs: 40,
  });

  const result = await createDeployTaskAction(ctx, {
    create: {
      namespace: "ns-test",
      runner: { kind: "template" },
      source: { kind: "template", templateName: "demo" },
      target: { kind: "existingProject", projectId: "project-test" },
    },
    run: async (handle) => {
      // Slower than the lease: only timer renewal keeps this run alive.
      await new Promise((resolve) => setTimeout(resolve, 400));
      await handle.beginApplying();
      await handle.complete();
    },
  });
  assert.equal(result.kind, "created");
  if (result.kind !== "created") {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  const midSweep = await runDeployTaskReaperSweep(ctx);
  assert.equal(midSweep.interrupted, 0);
  assert.equal((await taskById(result.task.id)).status, "running");

  await result.launched?.done;
  assert.equal((await taskById(result.task.id)).status, "completed");
});

test("a redeploy chain keeps the root's identity after the root is purged", async () => {
  const ctx = testCtx();
  const root = await insertTaskRow(harness.db, {
    artifactSummary: {
      resultIdentities: { templateInstanceName: "demo-root-1" },
    },
    completedAt: new Date(),
    status: "failed",
  });

  const cloneB = await createDeployTaskAction(ctx, {
    create: { namespace: "ns-test" },
    predecessorTaskId: root.id,
    run: async () => {
      /* parked */
    },
  });
  assert.equal(cloneB.kind, "created");
  if (cloneB.kind !== "created") {
    return;
  }
  // B fails without ever generating artifacts; the root is purged.
  await harness.db
    .update(deployTasks)
    .set({ completedAt: new Date(), status: "failed" })
    .where(eq(deployTasks.id, cloneB.task.id));
  await harness.db.delete(deployTasks).where(eq(deployTasks.id, root.id));

  const cloneC = await createDeployTaskAction(ctx, {
    create: { namespace: "ns-test" },
    predecessorTaskId: cloneB.task.id,
    run: async () => {
      /* parked */
    },
  });
  assert.equal(cloneC.kind, "created");
  if (cloneC.kind !== "created") {
    return;
  }
  const stored = await taskById(cloneC.task.id);
  assert.equal(
    stored.artifactSummary.resultIdentities?.templateInstanceName,
    "demo-root-1"
  );
  assert.equal(stored.source.kind, "template");
});

test("purge retries on the next sweep when devbox deletion fails", async () => {
  const ctx = testCtx({ retentionMs: 60_000 });
  const stuck = await insertTaskRow(harness.db, {
    completedAt: new Date(Date.now() - 120_000),
    runtimeName: "devbox-stuck",
    runtimeProvider: "devbox",
    runtimeState: "paused",
    status: "failed",
  });

  devbox.failNextDelete = true;
  const first = await runDeployTaskReaperSweep(ctx);
  assert.equal(first.purgeFailed, 1);
  assert.ok(await taskById(stuck.id));

  const second = await runDeployTaskReaperSweep(ctx);
  assert.equal(second.purged, 1);
  const [gone] = await harness.db
    .select({ id: deployTasks.id })
    .from(deployTasks)
    .where(eq(deployTasks.id, stuck.id));
  assert.equal(gone, undefined);
});
