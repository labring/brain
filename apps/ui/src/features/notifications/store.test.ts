import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { identityFingerprints } from "@/features/chat/persistence/schema";
import { dbNotificationId } from "./notification-ids";
import { notificationMessages, notificationReadReceipts } from "./schema";
import { createNotificationStore, type NotificationReader } from "./store";

const testSchema = {
  identityFingerprints,
  notificationMessages,
  notificationReadReceipts,
};

const pglite = new PGlite();
const db = drizzle(pglite, { schema: testSchema });
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  ),
});

const store = createNotificationStore(() => db);

afterAll(() => pglite.close());

const NOW = new Date("2026-08-27T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const SUPERSEDED_RE = /superseded/;

async function bindIdentity(crName: string, userUid: string): Promise<void> {
  await db
    .insert(identityFingerprints)
    .values({ crName, mintedAt: 1, userUid })
    .onConflictDoNothing();
}

function reader(
  overrides: Partial<NotificationReader> = {}
): NotificationReader {
  return {
    legacyWorkspaceActor: "alice",
    namespace: "ns-a",
    userUid: "alice-uid",
    ...overrides,
  };
}

function quotaPayload(resource: "cpu" | "memory" | "storage") {
  return { kind: "quota-exhausted" as const, limit: 10, resource, used: 10 };
}

test("produce writes one entry per dedupe key and retries dedupe", async () => {
  const first = await store.produce({
    dedupeKey: "quota-exhausted:ns-a:storage",
    kind: "quota-exhausted",
    namespace: "ns-a",
    now: NOW,
    payload: quotaPayload("storage"),
  });
  const retry = await store.produce({
    dedupeKey: "quota-exhausted:ns-a:storage",
    kind: "quota-exhausted",
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 1000),
    payload: quotaPayload("storage"),
  });

  assert.equal(first, true);
  assert.equal(retry, false);
  const messages = await store.listMessages("ns-a");
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.kind, "quota-exhausted");
  assert.deepEqual(messages[0]?.payload, quotaPayload("storage"));
  assert.equal(messages[0]?.createdAt, NOW.getTime());
});

test("release frees the dedupe key, keeps history, and lets the next crossing write again", async () => {
  const released = await store.release({
    dedupeKey: "quota-exhausted:ns-a:storage",
    now: new Date(NOW.getTime() + 2000),
  });
  const releasedAgain = await store.release({
    dedupeKey: "quota-exhausted:ns-a:storage",
  });
  const reproduced = await store.produce({
    dedupeKey: "quota-exhausted:ns-a:storage",
    kind: "quota-exhausted",
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 3000),
    payload: quotaPayload("storage"),
  });

  assert.equal(released, true);
  assert.equal(releasedAgain, false, "a released key releases nothing twice");
  assert.equal(reproduced, true, "recovery resets the edge trigger");
  const messages = await store.listMessages("ns-a");
  assert.equal(messages.length, 2, "the released entry stays as history");
  assert.equal(messages[0]?.createdAt, NOW.getTime() + 3000, "newest first");
});

test("messages are isolated per namespace", async () => {
  await store.produce({
    dedupeKey: "quota-exhausted:ns-b:cpu",
    kind: "quota-exhausted",
    namespace: "ns-b",
    now: NOW,
    payload: quotaPayload("cpu"),
  });

  const a = await store.listMessages("ns-a");
  const b = await store.listMessages("ns-b");
  assert.equal(a.length, 2);
  assert.equal(b.length, 1);
  assert.equal(
    b[0]?.payload.kind === "quota-exhausted" ? b[0].payload.resource : null,
    "cpu"
  );
});

test("receipts are per user, follow the person across workspaces, and db receipts attach their row", async () => {
  await bindIdentity("alice", "alice-uid");
  await bindIdentity("bob", "bob-uid");
  const [message] = await store.listMessages("ns-b");
  assert.ok(message);
  const dbId = dbNotificationId(message.id);
  const crId = "cr:debt-choice-debtperiod:1756200000";

  await store.markRead(reader({ namespace: "ns-b" }), [dbId, crId, crId]);
  await store.markRead(reader({ namespace: "ns-b" }), [dbId]);

  assert.deepEqual(
    (await store.listReceipts("alice-uid")).sort(),
    [crId, dbId].sort()
  );
  assert.deepEqual(
    await store.listReceipts("bob-uid"),
    [],
    "another user's inbox is untouched"
  );
  const [receipt] = await db
    .select({ messageId: notificationReadReceipts.messageId })
    .from(notificationReadReceipts)
    .where(
      and(
        eq(notificationReadReceipts.userUid, "alice-uid"),
        eq(notificationReadReceipts.messageKey, dbId)
      )
    );
  assert.equal(receipt?.messageId, message.id);
});

test("a db receipt for a foreign or unknown message is ignored, not refused", async () => {
  const [foreign] = await store.listMessages("ns-a");
  assert.ok(foreign);

  await store.markRead(reader({ namespace: "ns-b" }), [
    dbNotificationId(foreign.id),
    dbNotificationId("does-not-exist"),
  ]);

  const receipts = await store.listReceipts("alice-uid");
  assert.equal(receipts.includes(dbNotificationId(foreign.id)), false);
  assert.equal(receipts.includes(dbNotificationId("does-not-exist")), false);
});

test("marking read refuses a superseded identity binding", async () => {
  await assert.rejects(
    store.markRead(
      reader({ legacyWorkspaceActor: "alice", userUid: "someone-else-uid" }),
      ["cr:x:1"]
    ),
    SUPERSEDED_RE
  );
});

test("writes sweep entries older than 365 days and their receipts cascade", async () => {
  const old = new Date(NOW.getTime() - 400 * DAY_MS);
  await store.produce({
    dedupeKey: "quota-exhausted:ns-c:memory",
    kind: "quota-exhausted",
    namespace: "ns-c",
    now: old,
    payload: quotaPayload("memory"),
  });
  const [oldMessage] = await store.listMessages("ns-c");
  assert.ok(oldMessage);
  await bindIdentity("carol", "carol-uid");
  const carol = reader({
    legacyWorkspaceActor: "carol",
    namespace: "ns-c",
    userUid: "carol-uid",
  });
  await store.markRead(carol, [dbNotificationId(oldMessage.id), "cr:keep:1"]);

  // Any later write sweeps: here a different namespace's entry.
  await store.produce({
    dedupeKey: "quota-exhausted:ns-d:cpu",
    kind: "quota-exhausted",
    namespace: "ns-d",
    now: NOW,
    payload: quotaPayload("cpu"),
  });

  assert.deepEqual(await store.listMessages("ns-c"), []);
  assert.deepEqual(
    await store.listReceipts("carol-uid"),
    ["cr:keep:1"],
    "the swept row's receipt cascades; the CR receipt stays"
  );
  assert.equal(
    (await store.listMessages("ns-a")).length,
    2,
    "entries inside the window survive"
  );
});
