import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAccountBalance } from "../../account-balance";
import { loadAiCredits } from "../../billing-ai-credits";
import { loadBillingCosts } from "../../billing-costs-data";
import type { BillingFetch } from "../../billing-data-client";
import {
  loadBillingPlanSnapshot,
  loadSubscriptionUpgradeQuote,
} from "../../billing-plan-data";
import { loadBillingPricing } from "../../billing-pricing-data";
import { loadBillingUsage } from "../../billing-usage-data";
import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  formatBillingDevMockCookie,
} from "../../dev-mock-cookie";
import { billingDevMockResponse } from "./index";
import { scenarioTestFetch } from "./scenario-test-fetch";

/**
 * Pins every dev-mock scenario to the real loaders: each fixture payload must
 * survive the loaders' zod parsing, and the lifecycle derivations must land
 * on the state the scenario name promises. Also pins the write transitions —
 * a successful mutation must move the scenario cookie.
 */

function mockCookieHeader(scenario: string): string {
  return `${BILLING_DEV_MOCK_COOKIE}=${scenario}`;
}

function mockRequest(
  pathname: string,
  scenario: string,
  init?: RequestInit
): Request {
  const request = new Request(new URL(pathname, "http://localhost"), init);
  request.headers.set("cookie", mockCookieHeader(scenario));
  return request;
}

const mockFetchFor: (scenario: string) => BillingFetch = scenarioTestFetch;

function payRequest(scenario: string, operator: string): Request {
  return mockRequest("/api/billing/subscription/pay", scenario, {
    body: JSON.stringify({ operator, workspace: "ns-test" }),
    method: "POST",
  });
}

function scenarioFromSetCookie(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  if (header == null) {
    return null;
  }
  const match = header.match(new RegExp(`${BILLING_DEV_MOCK_COOKIE}=([^;]+)`));
  return match?.[1] ?? null;
}

const CREDENTIALS = {
  appToken: "test-token",
  kubeconfig: "test-kubeconfig",
  workspace: "ns-test",
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const DATE_RANGE = {
  endTime: new Date().toISOString(),
  startTime: new Date(Date.now() - 31 * DAY_IN_MILLISECONDS).toISOString(),
};

const CREDITLESS_SCENARIOS = new Set([
  "free",
  "free-expired",
  "paused",
  "payg",
  "payg-debt",
]);

function loadPlanForScenario(scenario: string) {
  return loadBillingPlanSnapshot(CREDENTIALS, {
    fetch: mockFetchFor(scenario),
  });
}

test("every scenario passes every loader's schemas", async () => {
  for (const scenario of BILLING_DEV_SCENARIOS) {
    const mockFetch = mockFetchFor(scenario);
    const [plan, usage, pricing, costs, balance, credits] = await Promise.all([
      loadBillingPlanSnapshot(CREDENTIALS, { fetch: mockFetch }),
      loadBillingUsage(CREDENTIALS, { fetch: mockFetch }),
      loadBillingPricing(CREDENTIALS, { fetch: mockFetch }),
      loadBillingCosts(
        {
          appToken: CREDENTIALS.appToken,
          dateRange: DATE_RANGE,
          kubeconfig: CREDENTIALS.kubeconfig,
          page: 1,
          pageSize: 10,
          workspace: null,
        },
        mockFetch
      ),
      loadAccountBalance(
        {
          appToken: CREDENTIALS.appToken,
          currency: "usd",
          kubeconfig: CREDENTIALS.kubeconfig,
        },
        mockFetch
      ),
      loadAiCredits(CREDENTIALS, mockFetch),
    ]);
    assert.equal(plan.plans.length, 9, `${scenario}: plan catalog loads`);
    assert.ok(usage.rows.length >= 5, `${scenario}: usage rows load`);
    assert.ok(pricing.prices.length >= 6, `${scenario}: metered prices load`);
    assert.equal(costs.appOverviews.length, 8, `${scenario}: overviews load`);
    assert.ok(costs.costPoints.length > 0, `${scenario}: cost points load`);
    assert.ok(
      Number.isFinite(balance.microUnits),
      `${scenario}: balance loads`
    );
    assert.ok(
      Number.isFinite(credits.usedMicroUnits) &&
        Number.isFinite(credits.totalMicroUnits),
      `${scenario}: AI Credits load`
    );
    if (CREDITLESS_SCENARIOS.has(scenario)) {
      assert.equal(
        credits.totalMicroUnits,
        0,
        `${scenario}: PAYG modes and Free plans have no AI Credits`
      );
    } else {
      assert.ok(
        credits.totalMicroUnits > 0,
        `${scenario}: paid subscription includes AI Credits`
      );
    }
  }
});

test("cost-overview fixture honors page and pageSize", async () => {
  const mockFetch = mockFetchFor("active");
  const page1 = await loadBillingCosts(
    {
      appToken: CREDENTIALS.appToken,
      dateRange: DATE_RANGE,
      kubeconfig: CREDENTIALS.kubeconfig,
      page: 1,
      pageSize: 5,
      workspace: null,
    },
    mockFetch
  );
  const page2 = await loadBillingCosts(
    {
      appToken: CREDENTIALS.appToken,
      dateRange: DATE_RANGE,
      kubeconfig: CREDENTIALS.kubeconfig,
      page: 2,
      pageSize: 5,
      workspace: null,
    },
    mockFetch
  );
  assert.equal(page1.appOverviews.length, 5);
  assert.equal(page1.totalAppOverviews, 8);
  assert.equal(page1.totalAppOverviewPages, 2);
  assert.equal(page2.appOverviews.length, 3);
  assert.equal(page2.totalAppOverviewPages, 2);
  assert.notEqual(
    page1.appOverviews[0]?.appName,
    page2.appOverviews[0]?.appName
  );
});

test("payg derives a PAYG snapshot", async () => {
  const plan = await loadPlanForScenario("payg");
  assert.equal(plan.current.isPayg, true);
  assert.equal(plan.current.canManage, true);
  assert.equal(plan.card, null);
});

test("active derives an active stripe subscription with a card", async () => {
  const plan = await loadPlanForScenario("active");
  assert.equal(plan.current.isPayg, false);
  assert.equal(plan.current.lifecycle, "active");
  assert.equal(plan.current.payMethod, "stripe");
  assert.equal(plan.card?.last4, "4242");
  assert.ok(
    plan.current.currentPeriodEndAt,
    "CurrentPeriodEndAt carries a real date so the header Renewal Time renders"
  );
  assert.equal(plan.current.periodEndVoice, "renewal");
});

test("payg-debt derives a PAYG workspace inside the debt pipeline", async () => {
  const plan = await loadPlanForScenario("payg-debt");
  assert.equal(plan.current.isPayg, true);
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.equal(plan.current.warningStage, "expired");
  assert.equal(
    plan.current.warningDeadlineAt,
    null,
    "no period timestamps exist to derive a deletion date from"
  );
  const balance = await loadAccountBalance(
    { appToken: "t", currency: "usd", kubeconfig: "k" },
    mockFetchFor("payg-debt")
  );
  assert.ok(balance.microUnits < 0, "the account balance sits in debt");
});

test("free derives an active trial that never reads as cancelling", async () => {
  const plan = await loadPlanForScenario("free");
  assert.equal(plan.current.planName, "Free");
  assert.equal(plan.current.cancelAtPeriodEnd, true);
  assert.equal(plan.current.lifecycle, "active");
  assert.equal(plan.current.warningStage, null);
  assert.equal(plan.current.priceMicroUnits, 0);
  // AIM-254: the trial's period end is the plan's expiry, not a reset or a
  // renewal — and never blanked by the constructed CancelAtPeriodEnd flag.
  assert.equal(plan.current.periodEndVoice, "expiry");
});

test("free-expired derives the resubscribe voice inside the debt pipeline", async () => {
  // ADR-0065: a lapsed trial joins the same DEBT pipeline as a paid plan;
  // the recovery voice is what keeps its surfaces from asking for a renewal
  // or a payment.
  const plan = await loadPlanForScenario("free-expired");
  assert.equal(plan.current.planName, "Free");
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.equal(plan.current.warningStage, "expired");
  assert.equal(plan.current.recoveryVoice, "resubscribe");
  assert.equal(plan.current.isActiveFreeTrial, false);
  assert.equal(plan.current.invoiceId, null, "nothing was ever charged");
  assert.ok(plan.current.warningDeadlineAt, "deletion date is derived");
});

test("paused derives a plan-change-ready Free subscription", async () => {
  const plan = await loadPlanForScenario("paused");
  assert.equal(plan.current.planName, "Free");
  assert.equal(plan.current.lifecycle, "active");
  assert.equal(plan.current.warningStage, null);
  assert.equal(plan.current.currentPeriodEndAt, "", "no period is running");
  assert.equal(plan.current.periodEndVoice, "expiry");
});

test("deleted derives the subscribable-again PAYG shape", async () => {
  // AIM-252: a DELETED record is not a Workspace Subscription — the
  // workspace is PAYG and may subscribe anew.
  const plan = await loadPlanForScenario("deleted");
  assert.equal(plan.current.lifecycle, "active");
  assert.equal(plan.current.isPayg, true);
  assert.equal(plan.current.planName, "PAYG");
  assert.equal(plan.current.warningStage, null);
  assert.equal(plan.current.invoiceId, null);
  assert.ok(
    plan.plans.every((entry) => entry.changeKind === "subscribe"),
    "every catalog plan offers a fresh subscription"
  );
});

test("payment-due-final derives deletion-imminent with a past date", async () => {
  const plan = await loadPlanForScenario("payment-due-final");
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.equal(plan.current.warningStage, "deletion-imminent");
  assert.ok(plan.current.warningDeadlineAt, "deletion date is derived");
  assert.ok(
    new Date(plan.current.warningDeadlineAt ?? "").getTime() < Date.now(),
    "the derived deletion date is already behind us in the final stage"
  );
});

test("status-unknown derives the fail-closed unavailable lifecycle", async () => {
  const plan = await loadPlanForScenario("status-unknown");
  assert.equal(plan.current.lifecycle, "unavailable");
  assert.equal(plan.current.warningStage, null);
});

test("active-balance derives balance pay without a card", async () => {
  const plan = await loadPlanForScenario("active-balance");
  assert.equal(plan.current.lifecycle, "active");
  assert.equal(plan.current.payMethod, "balance");
  assert.equal(plan.card, null);
});

test("cancelling derives the cancelling lifecycle", async () => {
  const plan = await loadPlanForScenario("cancelling");
  assert.equal(plan.current.lifecycle, "cancelling");
  assert.equal(plan.current.cancelAtPeriodEnd, true);
  assert.equal(plan.current.warningStage, "cancelling");
  assert.equal(
    plan.current.warningDeadlineAt,
    new Date(plan.current.currentPeriodEndAt).toISOString(),
    "pre-expiry the deadline is the suspension date, with no grace added"
  );
  assert.equal(
    plan.current.periodEndVoice,
    "silent",
    "the suspension date is voiced by the warning banner, not the date fields"
  );
});

test("payment-due derives debt with a payable invoice", async () => {
  const plan = await loadPlanForScenario("payment-due");
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.equal(plan.current.warningStage, "expired");
  assert.equal(
    plan.current.periodEndVoice,
    "silent",
    "the past period end is noise; the destructive banner owns the dates"
  );
  assert.ok(plan.current.invoicePaymentUrl);
  assert.ok(plan.current.warningDeadlineAt, "deletion date is derived");
  assert.ok(
    new Date(plan.current.warningDeadlineAt ?? "").getTime() > Date.now(),
    "the deletion date is still ahead in the expired stage"
  );
  const balance = await loadAccountBalance(
    { appToken: "t", currency: "usd", kubeconfig: "k" },
    mockFetchFor("payment-due")
  );
  assert.ok(balance.microUnits < 0, "debt scenario shows a negative balance");
});

test("payment-due-deletion derives the deletion-imminent stage", async () => {
  const plan = await loadPlanForScenario("payment-due-deletion");
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.equal(plan.current.warningStage, "deletion-imminent");
  assert.ok(plan.current.warningDeadlineAt, "deletion date is derived");
});

test("pending-upgrade derives the queued plan change", async () => {
  const plan = await loadPlanForScenario("pending-upgrade");
  assert.equal(plan.current.lifecycle, "pending-upgrade");
  assert.equal(plan.pendingUpgrade?.planName, "Pro");
});

test("pending-upgrade quote recovers the mock unpaid invoice", async () => {
  const result = await loadSubscriptionUpgradeQuote(
    {
      ...CREDENTIALS,
      planName: "Team",
      regionDomain: "mock.sealos.run",
    },
    { fetch: mockFetchFor("pending-upgrade") }
  );

  assert.equal(result.kind, "pending-upgrade");
  if (result.kind === "pending-upgrade") {
    assert.equal(result.pendingUpgrade.invoiceId, "inv-123");
    assert.equal(result.pendingUpgrade.paymentId, "pay-mock-upgrade");
    assert.equal(result.pendingUpgrade.planName, "Pro");
  }
});

test("mixed-workspaces spreads lifecycles across the workspace list", async () => {
  const plan = await loadPlanForScenario("mixed-workspaces");
  assert.equal(plan.workspaces.length, 5);
  const lifecycles = new Set(
    plan.workspaces.map((workspace) => workspace.lifecycle)
  );
  assert.ok(lifecycles.has("active"));
  assert.ok(lifecycles.has("cancelling"));
  assert.ok(lifecycles.has("payment-due"));
  assert.ok(
    plan.workspaces.some((workspace) => workspace.priceMicroUnits == null),
    "a PAYG workspace row is present"
  );
});

test("pay transitions move the scenario cookie", async () => {
  const transitions: [string, string, string][] = [
    ["payg", "created", "active"],
    ["payg-debt", "created", "active"],
    ["deleted", "created", "active"],
    ["free-expired", "created", "active"],
    ["payment-due", "created", "active"],
    ["payment-due-deletion", "created", "active"],
    ["payment-due-final", "created", "active"],
    ["active", "canceled", "cancelling"],
    ["cancelling", "resumed", "active"],
    ["active-balance", "upgraded", "active"],
    ["free", "upgraded", "active"],
    ["paused", "upgraded", "active"],
  ];
  for (const [from, operator, to] of transitions) {
    const response = await billingDevMockResponse(
      "/account/v1alpha1/workspace-subscription/pay",
      payRequest(from, operator)
    );
    assert.equal(response?.status, 200, `${operator} from ${from} succeeds`);
    assert.equal(
      scenarioFromSetCookie(response),
      to,
      `${operator} moves ${from} → ${to}`
    );
  }
});

test("checkout operators answer a pollable payment", async () => {
  const response = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/pay",
    payRequest("payg", "created")
  );
  const payload = (await response?.json()) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.ok(payload.redirectUrl, "the checkout dialog insists on a URL");
  const payId = payload.payID;
  assert.ok(typeof payId === "string" && payId !== "");

  // The destination scenario's last-transaction must settle that payID, or
  // the checkout dialog's payment poll never completes.
  const transaction = await loadBillingPlanSnapshot(CREDENTIALS, {
    fetch: mockFetchFor("active"),
  });
  assert.equal(transaction.pendingUpgrade, null);
  const status = await (
    await billingDevMockResponse(
      "/account/v1alpha1/workspace-subscription/last-transaction",
      mockRequest("/api/billing/subscription/last-transaction", "active", {
        body: "{}",
        method: "POST",
      })
    )
  )?.json();
  assert.equal(status.transaction.PayID, payId);
  assert.equal(status.transaction.Status, "completed");
});

test("lifecycle operators answer plain success without a checkout", async () => {
  const response = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/pay",
    payRequest("active", "canceled")
  );
  assert.deepEqual(await response?.json(), { success: true });
});

test("invoice-cancel drops a queued upgrade back to active", async () => {
  const response = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/invoice-cancel",
    mockRequest("/api/billing/subscription/invoice-cancel", "pending-upgrade", {
      body: JSON.stringify({ invoiceID: "inv-123", workspace: "ns-test" }),
      method: "POST",
    })
  );
  assert.equal(response?.status, 200);
  assert.equal(scenarioFromSetCookie(response), "active");
  const payload = (await response?.json()) as Record<string, unknown>;
  assert.equal(payload.success, true);
  assert.equal(payload.invoice_id, "inv-123");
});

test("unmapped writes answer 501 instead of reaching upstream", async () => {
  const card = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/card-manage",
    mockRequest("/api/billing/card/manage", "active", {
      body: "{}",
      method: "POST",
    })
  );
  assert.equal(card?.status, 501);

  const downgrade = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/pay",
    payRequest("active", "downgraded")
  );
  assert.equal(downgrade?.status, 501);
});

test("an absent or disabled cookie falls through to the real proxy", async () => {
  const absent = await billingDevMockResponse(
    "/account/v1alpha1/regions",
    new Request("http://localhost/api/billing/regions")
  );
  assert.equal(absent, null);

  const disabled = await billingDevMockResponse(
    "/account/v1alpha1/regions",
    mockRequest(
      "/api/billing/regions",
      formatBillingDevMockCookie({ enabled: false, scenario: "active" })
    )
  );
  assert.equal(disabled, null);
});

test("unknown scenarios fail loud instead of falling through", async () => {
  const response = await billingDevMockResponse(
    "/account/v1alpha1/regions",
    mockRequest("/api/billing/regions", "dept")
  );
  assert.equal(response?.status, 500);
});
