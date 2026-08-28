import { afterAll, test } from "bun:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { loadAccountCredits } from "@/features/billing/account-credits";
import { loadSubscriptionTransactionStatus } from "@/features/billing/billing-plan-data";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";
import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";
import { identityFingerprints } from "@/features/chat/persistence/schema";

import { observeGiftCreditForNotifications } from "./producer-credit-hint";
import { observeWorkspaceQuotaForNotifications } from "./producer-quota-exhausted";
import { observeSubscriptionChangeForNotifications } from "./producer-subscription-change";
import { notificationMessages, notificationReadReceipts } from "./schema";
import { createNotificationStore } from "./store";
import { subscriptionChangeReceiptFromTransaction } from "./subscription-change-observer";

/**
 * The producers driven from the dev-fixture scenario seam: each scenario's
 * billing fixtures pass through the real loaders and into the producer, and
 * the store shows exactly one row per crossing, none on retry, and a reset
 * on recovery.
 */

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

const CREDENTIALS = { appToken: "test-token", kubeconfig: "test-kubeconfig" };
const WORKSPACE = "ns-fixture";

const QUANTITY_RE = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi)?$/;

/** Test-only reading of the fixture's Kubernetes quantities (Mi / millicores). */
function quantity(value: string): number {
  const match = QUANTITY_RE.exec(value);
  assert.ok(match, `quantity ${value}`);
  const amount = Number(match[1]);
  switch (match[2]) {
    case "Gi":
      return amount * 1024;
    case "Ki":
      return amount / 1024;
    case "m":
      return amount;
    case "Mi":
      return amount;
    default:
      return amount * 1000;
  }
}

async function quotaSnapshotFor(
  scenario: string
): Promise<WorkspaceResourceQuotaSnapshot> {
  const response = await scenarioTestFetch(scenario)(
    "/api/billing/workspace-quota",
    { body: JSON.stringify({ workspace: WORKSPACE }), method: "POST" }
  );
  const payload = (await response.json()) as {
    quota: { hard: Record<string, string>; used: Record<string, string> };
  };
  const item = (type: "cpu" | "storage", key: string) => ({
    limit: quantity(payload.quota.hard[key] ?? "0"),
    type,
    used: quantity(payload.quota.used[key] ?? "0"),
  });
  return {
    items: [item("cpu", "limits.cpu"), item("storage", "requests.storage")],
  };
}

test("quota-full's storage crosses 100% once; active's usage releases it", async () => {
  const full = await quotaSnapshotFor("quota-full");
  const first = await observeWorkspaceQuotaForNotifications(store, {
    namespace: WORKSPACE,
    snapshot: full,
  });
  const retry = await observeWorkspaceQuotaForNotifications(store, {
    namespace: WORKSPACE,
    snapshot: full,
  });
  assert.deepEqual(first, { produced: ["storage"], released: [] });
  assert.deepEqual(retry, { produced: [], released: [] });

  const recovered = await observeWorkspaceQuotaForNotifications(store, {
    namespace: WORKSPACE,
    snapshot: await quotaSnapshotFor("active"),
  });
  assert.deepEqual(recovered, { produced: [], released: ["storage"] });
  assert.equal(
    (
      await store.listMessages({
        namespace: WORKSPACE,
        userUid: "uid-newcomer",
      })
    ).length,
    1
  );
});

test("free's visible gift writes the hint once; active carries no gift", async () => {
  const gift = await loadAccountCredits(CREDENTIALS, scenarioTestFetch("free"));
  assert.ok(gift.giftMicroUnits > 0);
  const observe = (giftMicroUnits: number) =>
    observeGiftCreditForNotifications(store, {
      giftMicroUnits,
      namespace: WORKSPACE,
      userUid: "uid-newcomer",
    });
  assert.deepEqual(await observe(gift.giftMicroUnits), { produced: true });
  assert.deepEqual(await observe(gift.giftMicroUnits), { produced: false });

  const none = await loadAccountCredits(
    CREDENTIALS,
    scenarioTestFetch("active")
  );
  assert.deepEqual(await observe(none.giftMicroUnits), { produced: false });
});

test("active's settled checkout is one upgrade receipt, however often it is observed", async () => {
  const transaction = await loadSubscriptionTransactionStatus(
    { ...CREDENTIALS, regionDomain: "mock.sealos.run", workspace: WORKSPACE },
    { fetch: scenarioTestFetch("active") }
  );
  const receipt = subscriptionChangeReceiptFromTransaction(transaction);
  assert.deepEqual(receipt, {
    change: "upgraded",
    planName: "Hobby",
    transactionId: "txn-mock-settled",
  });
  assert.ok(receipt);
  const observe = () =>
    observeSubscriptionChangeForNotifications(store, {
      ...receipt,
      namespace: WORKSPACE,
    });
  assert.deepEqual(await observe(), { produced: true });
  assert.deepEqual(await observe(), { produced: false });

  const kinds = (
    await store.listMessages({ namespace: WORKSPACE, userUid: "uid-newcomer" })
  ).map((message) => message.kind);
  assert.deepEqual([...kinds].sort(), [
    "credit-hint",
    "quota-exhausted",
    "subscription-change",
  ]);
});
