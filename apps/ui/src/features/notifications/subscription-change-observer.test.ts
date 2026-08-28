import assert from "node:assert/strict";
import { test } from "node:test";

import type { SubscriptionTransactionStatus } from "@/features/billing/billing-plan-data";

import {
  cancellationReceipt,
  observeSubscriptionChangeQuietly,
  subscriptionChangeReceiptFromTransaction,
} from "./subscription-change-observer";

function tx(
  overrides: Partial<SubscriptionTransactionStatus>
): SubscriptionTransactionStatus {
  return {
    id: "txn-1",
    operator: "upgraded",
    payId: "pay-1",
    planName: "Pro",
    startAt: null,
    status: "completed",
    ...overrides,
  };
}

test("a completed upgrade or first subscription is an upgrade receipt keyed by the transaction", () => {
  assert.deepEqual(subscriptionChangeReceiptFromTransaction(tx({})), {
    change: "upgraded",
    planName: "Pro",
    transactionId: "txn-1",
  });
  assert.deepEqual(
    subscriptionChangeReceiptFromTransaction(
      tx({ id: "txn-2", operator: "created", planName: "Hobby" })
    ),
    { change: "upgraded", planName: "Hobby", transactionId: "txn-2" }
  );
});

test("a scheduled downgrade is a receipt with its effective date; unpaid, renewed, or absent transactions are none", () => {
  assert.deepEqual(
    subscriptionChangeReceiptFromTransaction(
      tx({
        id: "txn-3",
        operator: "downgraded",
        planName: "Hobby",
        startAt: "2026-09-27T12:00:00.000Z",
        status: "pending",
      })
    ),
    {
      change: "downgraded",
      effectiveAt: "2026-09-27T12:00:00.000Z",
      planName: "Hobby",
      transactionId: "txn-3",
    }
  );
  assert.equal(
    subscriptionChangeReceiptFromTransaction(tx({ status: "pending" })),
    null,
    "an unpaid upgrade invoice is not a change"
  );
  assert.equal(
    subscriptionChangeReceiptFromTransaction(tx({ operator: "renewed" })),
    null
  );
  assert.equal(subscriptionChangeReceiptFromTransaction(null), null);
  assert.equal(subscriptionChangeReceiptFromTransaction(tx({ id: "" })), null);
});

test("a cancellation is keyed by its transaction when the platform records one, else by the period end", () => {
  assert.deepEqual(
    cancellationReceipt({
      currentPeriodEndAt: "2026-09-08T00:00:00.000Z",
      planName: "Hobby",
      transaction: tx({ id: "txn-9", operator: "canceled" }),
    }),
    {
      change: "cancelled",
      effectiveAt: "2026-09-08T00:00:00.000Z",
      planName: "Hobby",
      transactionId: "txn-9",
    }
  );
  assert.deepEqual(
    cancellationReceipt({
      currentPeriodEndAt: "2026-09-08T00:00:00.000Z",
      planName: "Hobby",
      transaction: tx({ id: "txn-1", operator: "upgraded" }),
    }),
    {
      change: "cancelled",
      effectiveAt: "2026-09-08T00:00:00.000Z",
      planName: "Hobby",
      transactionId: "cancel:2026-09-08T00:00:00.000Z",
    }
  );
});

test("the quiet observer reads the last transaction and reports; failures never throw", async () => {
  const reported: unknown[] = [];
  await observeSubscriptionChangeQuietly(
    {
      appToken: "t",
      kubeconfig: "k",
      regionDomain: "r",
      workspace: "ns-a",
    },
    {
      loadTransaction: () => Promise.resolve(tx({})),
      report: (_credentials, observation) => {
        reported.push(observation);
        return Promise.resolve();
      },
    }
  );
  assert.deepEqual(reported, [
    { change: "upgraded", planName: "Pro", transactionId: "txn-1" },
  ]);

  await observeSubscriptionChangeQuietly(
    {
      appToken: "t",
      cancelled: {
        currentPeriodEndAt: "2026-09-08T00:00:00.000Z",
        planName: "Hobby",
      },
      kubeconfig: "k",
      regionDomain: "r",
      workspace: "ns-a",
    },
    {
      loadTransaction: () => Promise.reject(new Error("offline")),
      report: (_credentials, observation) => {
        reported.push(observation);
        return Promise.resolve();
      },
    }
  );
  assert.equal(reported.length, 2);
  assert.deepEqual(reported[1], {
    change: "cancelled",
    effectiveAt: "2026-09-08T00:00:00.000Z",
    planName: "Hobby",
    transactionId: "cancel:2026-09-08T00:00:00.000Z",
  });

  await observeSubscriptionChangeQuietly(
    { appToken: "t", kubeconfig: "k", regionDomain: "r", workspace: "ns-a" },
    {
      loadTransaction: () => Promise.resolve(tx({})),
      report: () => Promise.reject(new Error("503")),
    }
  );
});
