import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { identityFingerprints } from "@/features/chat/persistence/schema";

import {
  observeSubscriptionChangeForNotifications,
  subscriptionChangeDedupeKey,
} from "./producer-subscription-change";
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

test("the dedupe key names workspace and transaction", () => {
  assert.equal(
    subscriptionChangeDedupeKey("ns-a", "txn-1"),
    "subscription-change:ns-a:txn-1"
  );
});

test("one receipt per successful change; the same transaction observed twice writes once", async () => {
  const first = await observeSubscriptionChangeForNotifications(store, {
    change: "upgraded",
    namespace: "ns-a",
    now: NOW,
    planName: "Pro",
    transactionId: "txn-1",
  });
  const again = await observeSubscriptionChangeForNotifications(store, {
    change: "upgraded",
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 60_000),
    planName: "Pro",
    transactionId: "txn-1",
  });
  const downgrade = await observeSubscriptionChangeForNotifications(store, {
    change: "downgraded",
    effectiveAt: "2026-09-27T12:00:00.000Z",
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 120_000),
    planName: "Hobby",
    transactionId: "txn-2",
  });

  assert.deepEqual(first, { produced: true });
  assert.deepEqual(again, { produced: false });
  assert.deepEqual(downgrade, { produced: true });
  const messages = await store.listMessages("ns-a");
  assert.deepEqual(
    messages.map((message) => message.payload),
    [
      {
        change: "downgraded",
        effectiveAt: "2026-09-27T12:00:00.000Z",
        kind: "subscription-change",
        planName: "Hobby",
      },
      { change: "upgraded", kind: "subscription-change", planName: "Pro" },
    ]
  );
});

test("the same transaction id in another workspace is another receipt; blanks write nothing", async () => {
  assert.deepEqual(
    await observeSubscriptionChangeForNotifications(store, {
      change: "cancelled",
      namespace: "ns-b",
      now: NOW,
      planName: "Pro",
      transactionId: "txn-1",
    }),
    { produced: true }
  );
  assert.deepEqual(
    await observeSubscriptionChangeForNotifications(store, {
      change: "cancelled",
      namespace: "ns-b",
      planName: "Pro",
      transactionId: "  ",
    }),
    { produced: false }
  );
  assert.deepEqual(
    await observeSubscriptionChangeForNotifications(store, {
      change: "cancelled",
      namespace: "",
      planName: "Pro",
      transactionId: "txn-3",
    }),
    { produced: false }
  );
});
