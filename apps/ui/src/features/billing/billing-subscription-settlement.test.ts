import assert from "node:assert/strict";
import { test } from "node:test";

import type { BillingFetch } from "./billing-data-client";
import { settleSubscriptionChange } from "./billing-subscription-settlement";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, deadlineMs = 2000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > deadlineMs) {
      throw new Error("Condition not reached in time.");
    }
    await sleep(5);
  }
}

function settlementFetch(input: {
  quotaTotals: () => number | Error;
  onBalanceRequest?: () => void;
  onQuotaRequest?: () => void;
}): BillingFetch {
  return (requestInput) => {
    const url = requestInput.toString();
    if (url === "/api/billing/account") {
      input.onBalanceRequest?.();
      return Promise.resolve(
        Response.json({ account: { Balance: 5_000_000, DeductionBalance: 0 } })
      );
    }
    if (url === "/api/billing/workspace-quota") {
      input.onQuotaRequest?.();
      const total = input.quotaTotals();
      if (total instanceof Error) {
        return Promise.resolve(
          new Response("upstream unavailable", { status: 502 })
        );
      }
      return Promise.resolve(
        Response.json({
          quota: { hard: { ai_quota: total }, used: { ai_quota: 0 } },
        })
      );
    }
    throw new Error(`Unexpected request: ${url}`);
  };
}

function credentials(workspace: string) {
  return {
    appToken: "app-token",
    currency: "usd" as const,
    kubeconfig: "apiVersion: v1",
    workspace,
  };
}

test("polls AI Credits until the total moves off the baseline, refreshing Account Balance once", async () => {
  let balanceRequests = 0;
  let quotaRequests = 0;
  const totals = [100, 100, 200];
  const cancel = settleSubscriptionChange({
    ...credentials("settle-until-changed"),
    baselineTotalMicroUnits: 100,
    fetch: settlementFetch({
      onBalanceRequest: () => {
        balanceRequests += 1;
      },
      onQuotaRequest: () => {
        quotaRequests += 1;
      },
      quotaTotals: () => totals[Math.min(quotaRequests - 1, 2)] ?? 200,
    }),
    intervalMs: 10,
    timeoutMs: 2000,
  });

  await until(() => quotaRequests >= 3);
  await sleep(60);
  assert.equal(quotaRequests, 3);
  assert.equal(balanceRequests, 1);
  cancel();
});

test("adopts the first fetched total as baseline when none is known", async () => {
  let quotaRequests = 0;
  const cancel = settleSubscriptionChange({
    ...credentials("settle-no-baseline"),
    fetch: settlementFetch({
      onQuotaRequest: () => {
        quotaRequests += 1;
      },
      quotaTotals: () => (quotaRequests <= 2 ? 100 : 200),
    }),
    intervalMs: 10,
    timeoutMs: 2000,
  });

  await until(() => quotaRequests >= 3);
  await sleep(60);
  assert.equal(quotaRequests, 3);
  cancel();
});

test("gives up silently once the settle window closes", async () => {
  let quotaRequests = 0;
  const cancel = settleSubscriptionChange({
    ...credentials("settle-timeout"),
    baselineTotalMicroUnits: 100,
    fetch: settlementFetch({
      onQuotaRequest: () => {
        quotaRequests += 1;
      },
      quotaTotals: () => 100,
    }),
    intervalMs: 10,
    timeoutMs: 45,
  });

  await sleep(150);
  const requestsAtTimeout = quotaRequests;
  assert.ok(requestsAtTimeout >= 1);
  assert.ok(requestsAtTimeout <= 6);
  await sleep(60);
  assert.equal(quotaRequests, requestsAtTimeout);
  cancel();
});

test("cancel stops the poll immediately", async () => {
  let quotaRequests = 0;
  const cancel = settleSubscriptionChange({
    ...credentials("settle-cancel"),
    baselineTotalMicroUnits: 100,
    fetch: settlementFetch({
      onQuotaRequest: () => {
        quotaRequests += 1;
      },
      quotaTotals: () => 100,
    }),
    intervalMs: 10,
    timeoutMs: 2000,
  });

  await until(() => quotaRequests >= 1);
  cancel();
  const requestsAtCancel = quotaRequests;
  await sleep(60);
  assert.equal(quotaRequests, requestsAtCancel);
});

test("keeps polling through transient failures until the total changes", async () => {
  let quotaRequests = 0;
  const cancel = settleSubscriptionChange({
    ...credentials("settle-transient-error"),
    baselineTotalMicroUnits: 100,
    fetch: settlementFetch({
      onQuotaRequest: () => {
        quotaRequests += 1;
      },
      quotaTotals: () => {
        if (quotaRequests === 1) {
          return new Error("upstream unavailable");
        }
        return 200;
      },
    }),
    intervalMs: 10,
    timeoutMs: 2000,
  });

  await until(() => quotaRequests >= 2);
  await sleep(60);
  assert.equal(quotaRequests, 2);
  cancel();
});
