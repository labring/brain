import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { identityFingerprints } from "@/features/chat/persistence/schema";

import {
  creditHintDedupeKey,
  observeGiftCreditForNotifications,
} from "./producer-credit-hint";
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

/** The verified binding every account-scoped write re-checks (ADR-0059). */
async function account(name: string) {
  const owner = { legacyWorkspaceActor: name, userUid: `uid-${name}` };
  await db
    .insert(identityFingerprints)
    .values({ crName: name, mintedAt: 1, userUid: owner.userUid })
    .onConflictDoNothing();
  return owner;
}

test("the dedupe key names the user, not the workspace", () => {
  assert.equal(creditHintDedupeKey("uid-alice"), "credit-hint:uid-alice");
});

test("a visible gift writes one hint per user; retries and other workspaces write nothing, and every workspace lists it", async () => {
  const first = await observeGiftCreditForNotifications(store, {
    giftMicroUnits: 720_000,
    namespace: "ns-a",
    now: NOW,
    account: await account("alice"),
  });
  const retry = await observeGiftCreditForNotifications(store, {
    giftMicroUnits: 700_000,
    namespace: "ns-a",
    now: new Date(NOW.getTime() + 60_000),
    account: await account("alice"),
  });
  const elsewhere = await observeGiftCreditForNotifications(store, {
    giftMicroUnits: 700_000,
    namespace: "ns-b",
    now: new Date(NOW.getTime() + 120_000),
    account: await account("alice"),
  });

  assert.deepEqual(first, { produced: true });
  assert.deepEqual(retry, { produced: false });
  assert.deepEqual(elsewhere, { produced: false });
  const messages = await store.listMessages({
    namespace: "ns-a",
    userUid: "uid-alice",
  });
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0]?.payload, {
    giftMicroUnits: 720_000,
    kind: "credit-hint",
  });
  // Account-scoped: the one row follows the person into a workspace that
  // never observed the gift, and stays out of another person's inbox there.
  assert.deepEqual(
    await store.listMessages({ namespace: "ns-b", userUid: "uid-alice" }),
    messages
  );
  assert.deepEqual(
    await store.listMessages({ namespace: "ns-a", userUid: "uid-someone" }),
    []
  );
});

test("another user gets their own hint; no gift writes nothing", async () => {
  assert.deepEqual(
    await observeGiftCreditForNotifications(store, {
      giftMicroUnits: 0,
      namespace: "ns-a",
      now: NOW,
      account: await account("bob"),
    }),
    { produced: false }
  );
  assert.deepEqual(
    await observeGiftCreditForNotifications(store, {
      giftMicroUnits: 1_000_000,
      namespace: "ns-a",
      now: NOW,
      account: await account("bob"),
    }),
    { produced: true }
  );
  assert.equal(
    (await store.listMessages({ namespace: "ns-a", userUid: "uid-bob" }))
      .length,
    1,
    "bob's inbox holds his own hint, not alice's"
  );
});

test("a blank user or workspace observes nothing", async () => {
  assert.deepEqual(
    await observeGiftCreditForNotifications(store, {
      giftMicroUnits: 1_000_000,
      namespace: " ",
      account: await account("carol"),
    }),
    { produced: false }
  );
  assert.deepEqual(
    await observeGiftCreditForNotifications(store, {
      account: { legacyWorkspaceActor: "carol", userUid: "" },
      giftMicroUnits: 1_000_000,
      namespace: "ns-a",
    }),
    { produced: false }
  );
});
