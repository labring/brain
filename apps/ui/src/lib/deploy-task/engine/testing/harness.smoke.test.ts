import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { eq, sql } from "drizzle-orm";

import { deployTaskEvents, deployTasks } from "../../schema";
import type { DeployTaskNotifyEvent } from "../notify";
import { insertTaskRow, nextFixtureId } from "./fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "./harness";

let harness: DeployTaskTestHarness;

const ONE_ACTIVE_CLONE_VIOLATION_RE =
  /deploy_tasks_one_active_clone_idx|duplicate key/;

before(async () => {
  harness = await createDeployTaskTestHarness();
});

after(async () => {
  await harness.close();
});

test("migrations apply on PGlite and the engine columns exist", async () => {
  const row = await insertTaskRow(harness.db, { status: "queued" });
  assert.equal(row.leaseEpoch, 0);
  assert.equal(row.leaseOwner, null);
  assert.equal(row.cancelRequestedAt, null);
  assert.equal(row.retriedFromTaskId, null);
});

test("single-statement conditional updates guard on source status", async () => {
  const row = await insertTaskRow(harness.db, { status: "queued" });

  const won = await harness.db
    .update(deployTasks)
    .set({ status: "cancelled" })
    .where(
      sql`${deployTasks.id} = ${row.id} AND ${deployTasks.status} = 'queued'`
    )
    .returning({ id: deployTasks.id });
  assert.equal(won.length, 1);

  const lost = await harness.db
    .update(deployTasks)
    .set({ status: "running" })
    .where(
      sql`${deployTasks.id} = ${row.id} AND ${deployTasks.status} = 'queued'`
    )
    .returning({ id: deployTasks.id });
  assert.equal(lost.length, 0);

  const [current] = await harness.db
    .select({ status: deployTasks.status })
    .from(deployTasks)
    .where(eq(deployTasks.id, row.id));
  assert.equal(current?.status, "cancelled");
});

test("LISTEN/NOTIFY delivers id-only payloads through the transport", async () => {
  const received: DeployTaskNotifyEvent[] = [];
  const unsubscribe = await harness.notify.subscribe((event) => {
    received.push(event);
  });

  await harness.notify.publish({
    kind: "change",
    namespace: "ns-test",
    projectId: "project-test",
    taskId: "task-notify",
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  await unsubscribe();

  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    kind: "change",
    namespace: "ns-test",
    projectId: "project-test",
    taskId: "task-notify",
  });
});

test("partial unique index allows one active clone per predecessor", async () => {
  const predecessor = await insertTaskRow(harness.db, {
    status: "failed",
    completedAt: new Date(),
  });

  await insertTaskRow(harness.db, {
    retriedFromTaskId: predecessor.id,
    status: "running",
  });

  await assert.rejects(
    insertTaskRow(harness.db, {
      retriedFromTaskId: predecessor.id,
      status: "queued",
    }),
    ONE_ACTIVE_CLONE_VIOLATION_RE
  );

  // A terminal clone frees the slot for the next recovery attempt.
  const activeCloneId = nextFixtureId();
  await harness.db
    .update(deployTasks)
    .set({ status: "failed" })
    .where(eq(deployTasks.retriedFromTaskId, predecessor.id));
  await insertTaskRow(harness.db, {
    id: activeCloneId,
    retriedFromTaskId: predecessor.id,
    status: "queued",
  });
});

test("event seq defaults from the global sequence, monotonic per task", async () => {
  const row = await insertTaskRow(harness.db, { status: "queued" });

  await harness.db.insert(deployTaskEvents).values({
    kind: "test.first",
    taskId: row.id,
  });
  await harness.db.insert(deployTaskEvents).values({
    kind: "test.second",
    taskId: row.id,
  });

  const events = await harness.db
    .select({ kind: deployTaskEvents.kind, seq: deployTaskEvents.seq })
    .from(deployTaskEvents)
    .where(eq(deployTaskEvents.taskId, row.id))
    .orderBy(deployTaskEvents.seq);

  assert.equal(events.length, 2);
  assert.equal(events[0]?.kind, "test.first");
  assert.equal(events[1]?.kind, "test.second");
  assert.ok((events[1]?.seq ?? 0) > (events[0]?.seq ?? 0));
});
