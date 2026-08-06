import { afterAll, beforeAll, mock, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { AssistantPgDatabase } from "../persistence/db";
import { assistantDevboxRuntimes } from "../persistence/schema";

mock.module("server-only", () => ({}));

const { recordChatDevboxActivity, runChatDevboxLifecycleSweep } = await import(
  "./lifecycle"
);

const DAY_MS = 24 * 60 * 60_000;
const NOW = new Date("2026-08-05T00:00:00.000Z");
let pglite: PGlite;
let db: AssistantPgDatabase;
const lifecycleSchema = { assistantDevboxRuntimes };
let testDb: ReturnType<typeof drizzle<typeof lifecycleSchema>>;

beforeAll(async () => {
  pglite = new PGlite();
  testDb = drizzle(pglite, { schema: lifecycleSchema });
  db = testDb as unknown as AssistantPgDatabase;
  const migrationsFolder = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle"
  );
  await migrate(testDb, { migrationsFolder });
});

afterAll(async () => {
  await pglite.close();
});

async function clearRuntimes() {
  await db.delete(assistantDevboxRuntimes);
}

test("activity resets a paused runtime before external resume", async () => {
  await clearRuntimes();
  await db.insert(assistantDevboxRuntimes).values({
    deleteDueAt: NOW,
    namespace: "ns-test",
    pausedAt: new Date(NOW.getTime() - DAY_MS),
    pauseDueAt: new Date(NOW.getTime() - 2 * DAY_MS),
    runtimeName: "runtime-a",
    upstreamId: "upstream-a",
  });
  const nextPause = new Date(NOW.getTime() + 5 * 60 * 60_000);

  await recordChatDevboxActivity(
    {
      namespace: "ns-test",
      pauseDueAt: nextPause,
      runtimeName: "runtime-a",
      upstreamId: "upstream-a",
    },
    db
  );

  const [runtime] = await db
    .select()
    .from(assistantDevboxRuntimes)
    .where(eq(assistantDevboxRuntimes.upstreamId, "upstream-a"));
  assert.equal(runtime?.pausedAt, null);
  assert.equal(runtime?.deleteDueAt, null);
  assert.equal(runtime?.pauseDueAt.toISOString(), nextPause.toISOString());
});

test("a chat Devbox is deleted only after 24 confirmed paused hours", async () => {
  await clearRuntimes();
  await db.insert(assistantDevboxRuntimes).values({
    namespace: "ns-test",
    pauseDueAt: new Date(NOW.getTime() - 1),
    runtimeName: "runtime-b",
    upstreamId: "upstream-b",
  });
  const paused: string[] = [];
  const deleted: string[] = [];
  const api = {
    delete(namespace: string, runtimeName: string) {
      deleted.push(`${namespace}/${runtimeName}`);
      return Promise.resolve("deleted" as const);
    },
    pause(namespace: string, runtimeName: string) {
      paused.push(`${namespace}/${runtimeName}`);
      return Promise.resolve("paused" as const);
    },
  };

  const first = await runChatDevboxLifecycleSweep({ api, db, now: () => NOW });
  assert.equal(first.paused, 1);
  assert.equal(first.deleted, 0);
  assert.deepEqual(paused, ["ns-test/runtime-b"]);

  const beforeDue = await runChatDevboxLifecycleSweep({
    api,
    db,
    now: () => new Date(NOW.getTime() + DAY_MS - 1),
  });
  assert.equal(beforeDue.deleted, 0);

  const afterDue = await runChatDevboxLifecycleSweep({
    api,
    db,
    now: () => new Date(NOW.getTime() + DAY_MS + 1),
  });
  assert.equal(afterDue.deleted, 1);
  assert.deepEqual(deleted, ["ns-test/runtime-b"]);
  const [runtime] = await db
    .select()
    .from(assistantDevboxRuntimes)
    .where(eq(assistantDevboxRuntimes.upstreamId, "upstream-b"));
  assert.equal(runtime, undefined);
});

test("delete failures retain lifecycle state for the next sweep", async () => {
  await clearRuntimes();
  await db.insert(assistantDevboxRuntimes).values({
    deleteDueAt: new Date(NOW.getTime() - 1),
    namespace: "ns-test",
    pausedAt: new Date(NOW.getTime() - DAY_MS - 1),
    pauseDueAt: new Date(NOW.getTime() - 2 * DAY_MS),
    runtimeName: "runtime-c",
    upstreamId: "upstream-c",
  });
  let failDelete = true;
  const api = {
    delete() {
      if (failDelete) {
        failDelete = false;
        return Promise.reject(new Error("delete unavailable"));
      }
      return Promise.resolve("deleted" as const);
    },
    pause: () => Promise.resolve("paused" as const),
  };

  const first = await runChatDevboxLifecycleSweep({ api, db, now: () => NOW });
  assert.equal(first.deleteFailed, 1);
  assert.equal(
    (
      await db
        .select()
        .from(assistantDevboxRuntimes)
        .where(eq(assistantDevboxRuntimes.upstreamId, "upstream-c"))
    ).length,
    1
  );

  await db
    .update(assistantDevboxRuntimes)
    .set({ cleanupLeaseExpiresAt: new Date(0) })
    .where(eq(assistantDevboxRuntimes.upstreamId, "upstream-c"));
  const second = await runChatDevboxLifecycleSweep({ api, db, now: () => NOW });
  assert.equal(second.deleted, 1);
});

test("concurrent chat lifecycle sweeps claim a runtime only once", async () => {
  await clearRuntimes();
  const currentNow = new Date();
  await db.insert(assistantDevboxRuntimes).values({
    namespace: "ns-test",
    pauseDueAt: new Date(currentNow.getTime() - 1),
    runtimeName: "runtime-d",
    upstreamId: "upstream-d",
  });
  let pauseCalls = 0;
  let releasePause!: () => void;
  let markPauseStarted!: () => void;
  const pauseStarted = new Promise<void>((resolve) => {
    markPauseStarted = resolve;
  });
  const pauseBlocked = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  const api = {
    delete: () => Promise.resolve("deleted" as const),
    async pause() {
      pauseCalls += 1;
      markPauseStarted();
      await pauseBlocked;
      return "paused" as const;
    },
  };

  const first = runChatDevboxLifecycleSweep({
    api,
    db,
    now: () => currentNow,
  });
  await pauseStarted;
  const second = await runChatDevboxLifecycleSweep({
    api,
    db,
    now: () => currentNow,
  });

  assert.equal(second.paused, 0);
  assert.equal(pauseCalls, 1);
  releasePause();
  assert.equal((await first).paused, 1);
});

test("activity waits for an in-flight delete claim before recreating the ledger", async () => {
  await clearRuntimes();
  const currentNow = new Date();
  await db.insert(assistantDevboxRuntimes).values({
    deleteDueAt: new Date(currentNow.getTime() - 1),
    namespace: "ns-test",
    pausedAt: new Date(currentNow.getTime() - DAY_MS - 1),
    pauseDueAt: new Date(currentNow.getTime() - 2 * DAY_MS),
    runtimeName: "runtime-e",
    upstreamId: "upstream-e",
  });
  let releaseDelete!: () => void;
  let markDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    markDeleteStarted = resolve;
  });
  const deleteBlocked = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const api = {
    async delete() {
      markDeleteStarted();
      await deleteBlocked;
      return "deleted" as const;
    },
    pause: () => Promise.resolve("paused" as const),
  };

  const sweep = runChatDevboxLifecycleSweep({
    api,
    db,
    now: () => currentNow,
  });
  await deleteStarted;
  const nextPause = new Date(currentNow.getTime() + 5 * 60 * 60_000);
  let activityFinished = false;
  const activity = recordChatDevboxActivity(
    {
      namespace: "ns-test",
      pauseDueAt: nextPause,
      runtimeName: "runtime-e",
      upstreamId: "upstream-e",
    },
    db
  ).then(() => {
    activityFinished = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(activityFinished, false);
  releaseDelete();
  await Promise.all([sweep, activity]);

  const [runtime] = await db
    .select()
    .from(assistantDevboxRuntimes)
    .where(eq(assistantDevboxRuntimes.upstreamId, "upstream-e"));
  assert.equal(runtime?.pausedAt, null);
  assert.equal(runtime?.deleteDueAt, null);
  assert.equal(runtime?.pauseDueAt.toISOString(), nextPause.toISOString());
});
