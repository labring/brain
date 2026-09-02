import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { WorkspaceQuotaItem } from "@/features/billing/workspace-resource-quota";
import { identityFingerprints } from "@/features/chat/persistence/schema";

import {
  isQuotaExhausted,
  observeWorkspaceQuotaForNotifications,
  quotaExhaustedDedupeKey,
} from "./producer-quota-exhausted";
import { notificationMessages, notificationReadReceipts } from "./schema";
import { createNotificationStore } from "./store";

const pglite = new PGlite();
const db = drizzle(pglite, {
  schema: {
    identityFingerprints,
    notificationMessages,
    notificationReadReceipts,
  },
});
await migrate(db, {
  migrationsFolder: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  ),
});
const store = createNotificationStore(() => db);

afterAll(() => pglite.close());

const NOW = new Date("2026-08-27T12:00:00Z");

function snapshot(...items: WorkspaceQuotaItem[]) {
  return { items };
}

test("isQuotaExhausted fires at 100% and never on an unknown limit", () => {
  assert.equal(
    isQuotaExhausted({ limit: 20, type: "storage", used: 20 }),
    true
  );
  assert.equal(
    isQuotaExhausted({ limit: 20, type: "storage", used: 25 }),
    true
  );
  assert.equal(
    isQuotaExhausted({ limit: 20, type: "storage", used: 19.9 }),
    false
  );
  assert.equal(isQuotaExhausted({ limit: 0, type: "pod", used: 0 }), false);
});

test("the dedupe key names workspace and resource", () => {
  assert.equal(
    quotaExhaustedDedupeKey("ns-a", "storage"),
    "quota-exhausted:ns-a:storage"
  );
});

test("crossing 100% writes one entry per resource; a retry writes nothing", async () => {
  const full = snapshot(
    { limit: 4000, type: "cpu", used: 4000 },
    { limit: 20_480, type: "storage", used: 20_480 },
    { limit: 4096, type: "memory", used: 3072 }
  );

  const first = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "ns-a",
    now: NOW,
    snapshot: full,
  });
  const retry = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 60_000),
    snapshot: full,
  });

  assert.deepEqual(first, { produced: ["cpu", "storage"], released: [] });
  assert.deepEqual(retry, { produced: [], released: [] });
  const messages = await store.listMessages({
    namespace: "ns-a",
    userUid: "viewer-uid",
  });
  assert.equal(messages.length, 2, "exactly one entry per exhausted resource");
  const resources = messages.map((message) =>
    message.payload.kind === "quota-exhausted" ? message.payload.resource : ""
  );
  assert.deepEqual(resources.sort(), ["cpu", "storage"]);
  assert.deepEqual(
    messages.find(
      (message) =>
        message.payload.kind === "quota-exhausted" &&
        message.payload.resource === "storage"
    )?.payload,
    {
      kind: "quota-exhausted",
      limit: 20_480,
      resource: "storage",
      used: 20_480,
    }
  );
});

test("falling below 100% resets; staying full re-sends nothing; re-crossing writes again", async () => {
  const recovered = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 120_000),
    snapshot: snapshot(
      { limit: 4000, type: "cpu", used: 4000 },
      { limit: 20_480, type: "storage", used: 10_240 }
    ),
  });
  assert.deepEqual(recovered, { produced: [], released: ["storage"] });

  const stillFull = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 180_000),
    snapshot: snapshot({ limit: 4000, type: "cpu", used: 4000 }),
  });
  assert.deepEqual(stillFull, { produced: [], released: [] });

  const reCrossed = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 240_000),
    snapshot: snapshot({ limit: 20_480, type: "storage", used: 20_480 }),
  });
  assert.deepEqual(reCrossed, { produced: ["storage"], released: [] });

  const messages = await store.listMessages({
    namespace: "ns-a",
    userUid: "viewer-uid",
  });
  assert.equal(messages.length, 3, "cpu once, storage twice across a recovery");
});

test("a blank namespace observes nothing", async () => {
  const result = await observeWorkspaceQuotaForNotifications(store, {
    namespace: "  ",
    snapshot: snapshot({ limit: 1, type: "pod", used: 1 }),
  });
  assert.deepEqual(result, { produced: [], released: [] });
});
