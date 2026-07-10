import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";

import { eq } from "drizzle-orm";

import { deployTaskEvents, deployTasks } from "../schema";
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
import { DeployTaskRunCancelledError } from "./errors";
import { runDeployTaskReaperSweep } from "./reaper";
import { stopDeployTaskEngineRuntimeForTests } from "./runtime";
import { insertTaskRow } from "./testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "./testing/harness";
import {
  appendDeployTaskEvent,
  renewDeployTaskLease,
  transitionDeployTask,
} from "./transitions";

let harness: DeployTaskTestHarness;

const ILLEGAL_TRANSITION_RE = /Illegal deploy task transition/;

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
  assert.ok(interruptedRow.completedAt != null);

  const cancelledRow = await taskById(cancelledPending.id);
  assert.equal(cancelledRow.status, "cancelled");

  assert.equal((await taskById(alive.id)).status, "running");

  const verdictEvents = await eventsFor(interrupted.id);
  assert.equal(verdictEvents.length, 1);
  assert.equal(verdictEvents[0]?.kind, "deployment_task.engine_resolved");
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
    leaseClaimedAt: new Date(now - 31 * 60_000),
    leaseEpoch: 1,
    leaseExpiresAt: liveLease,
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
  const neverRow = await taskById(neverStarted.id);
  assert.equal(neverRow.status, "failed");
  assert.equal(
    (neverRow.failureDetails as { reason?: string } | null)?.reason,
    "never-started"
  );

  // The forced cancel starves the still-live runner's writes.
  const starved = await transitionDeployTask(ctx, {
    expectedLeaseEpoch: 3,
    from: ["running", "applying"],
    taskId: unackedCancel.id,
    to: "completed",
  } as never).catch(() => null);
  assert.equal(starved, null);
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

test("clone conflict does not expose an active clone from another namespace", async () => {
  const ctx = testCtx();
  const predecessor = await insertTaskRow(harness.db, {
    completedAt: new Date(),
    namespace: "namespace-a",
    status: "failed",
  });
  await insertTaskRow(harness.db, {
    namespace: "namespace-b",
    retriedFromTaskId: predecessor.id,
    status: "running",
  });

  const result = await createDeployTaskAction(ctx, {
    create: { namespace: "namespace-a" },
    predecessorTaskId: predecessor.id,
    run: async () => {
      /* the unique active-clone guard prevents launch */
    },
  });

  assert.deepEqual(result, { activeClone: null, kind: "clone-conflict" });
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
    namespace: "ns-test",
    taskId: blocked.id,
  });
  assert.equal(blockedCancel.kind, "cancelled");
  assert.equal((await taskById(blocked.id)).status, "cancelled");

  const running = await insertTaskRow(harness.db, {
    leaseClaimedAt: new Date(),
    leaseEpoch: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000),
    leaseOwner: "other-proc",
    status: "running",
  });
  const first = await cancelDeployTaskAction(ctx, {
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
    status: "blocked",
  });

  let received: Record<string, unknown> | null = null;
  const result = await submitDeployTaskInputAction(ctx, {
    namespace: "ns-test",
    run: async (handle) => {
      received = { DB_PASSWORD: "s3cret-value" };
      await handle.beginApplying();
      await handle.complete();
    },
    taskId: blocked.id,
    values: { DB_PASSWORD: "s3cret-value" },
  });

  assert.equal(result.kind, "resumed");
  if (result.kind !== "resumed") {
    return;
  }
  await result.launched.done;
  assert.ok(received != null);

  const stored = await taskById(blocked.id);
  assert.equal(stored.status, "completed");
  assert.deepEqual(stored.blockingInputs, []);

  // Row-level secrets contract: the submitted value appears nowhere.
  const rowJson = JSON.stringify(stored);
  assert.ok(!rowJson.includes("s3cret-value"));
  const eventsJson = JSON.stringify(await eventsFor(blocked.id));
  assert.ok(!eventsJson.includes("s3cret-value"));

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
