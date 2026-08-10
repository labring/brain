/* eslint-disable turbo/no-undeclared-env-vars -- temporary dev-only knob, never a build input */
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { loadAccountBalance } from "../../account-balance";
import { loadBillingCosts } from "../../billing-costs-data";
import type { BillingFetch } from "../../billing-data-client";
import { loadBillingPlanSnapshot } from "../../billing-plan-data";
import { loadBillingPricing } from "../../billing-pricing-data";
import { loadBillingUsage } from "../../billing-usage-data";
import { billingDevMockResponse } from "./index";

/**
 * Pins every dev-mock scenario to the real loaders: each fixture payload must
 * survive the loaders' zod parsing, and the lifecycle derivations must land
 * on the state the scenario name promises. Delete together with the fixtures.
 */

const ROUTE_TO_UPSTREAM: Record<string, string> = {
  "/api/billing/account": "/account/v1alpha1/account",
  "/api/billing/app-costs": "/account/v1alpha1/costs/workspace/app",
  "/api/billing/app-overview": "/account/v1alpha1/cost-overview",
  "/api/billing/app-types": "/account/v1alpha1/cost-app-type-list",
  "/api/billing/card": "/account/v1alpha1/workspace-subscription/card-info",
  "/api/billing/consumption": "/account/v1alpha1/costs/consumption",
  "/api/billing/costs": "/account/v1alpha1/costs",
  "/api/billing/payments":
    "/account/v1alpha1/workspace-subscription/payment-list",
  "/api/billing/plans": "/account/v1alpha1/workspace-subscription/plan-list",
  "/api/billing/properties": "/account/v1alpha1/properties",
  "/api/billing/regions": "/account/v1alpha1/regions",
  "/api/billing/subscription": "/account/v1alpha1/workspace-subscription/info",
  "/api/billing/subscription/last-transaction":
    "/account/v1alpha1/workspace-subscription/last-transaction",
  "/api/billing/subscriptions": "/account/v1alpha1/workspace-subscription/list",
  "/api/billing/workspace-consumption":
    "/account/v1alpha1/costs/workspace/consumption",
  "/api/billing/workspace-quota":
    "/account/v1alpha1/workspace/get-resource-quota",
  "/api/billing/workspaces": "/account/v1alpha1/namespaces",
};

function requestPathname(input: Parameters<BillingFetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, "http://localhost").pathname;
}

const mockFetch: BillingFetch = async (input, init) => {
  const pathname = requestPathname(input);
  const upstream = ROUTE_TO_UPSTREAM[pathname];
  assert.ok(upstream, `route ${pathname} has an upstream mapping`);
  const response = await billingDevMockResponse(
    upstream,
    new Request(new URL(pathname, "http://localhost"), init)
  );
  assert.ok(response, "mock mode answers the request");
  return response;
};

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

const originalScenario = process.env.BILLING_DEV_MOCK;
after(() => {
  if (originalScenario === undefined) {
    delete process.env.BILLING_DEV_MOCK;
  } else {
    process.env.BILLING_DEV_MOCK = originalScenario;
  }
});

function loadPlanForScenario(scenario: string) {
  process.env.BILLING_DEV_MOCK = scenario;
  return loadBillingPlanSnapshot(CREDENTIALS, { fetch: mockFetch });
}

test("every scenario passes every loader's schemas", async () => {
  for (const scenario of [
    "payg",
    "active",
    "active-balance",
    "cancelling",
    "payment-due",
    "pending-upgrade",
    "mixed-workspaces",
  ]) {
    process.env.BILLING_DEV_MOCK = scenario;
    const [plan, usage, pricing, costs, balance] = await Promise.all([
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
  }
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
});

test("payment-due derives debt with a payable invoice", async () => {
  const plan = await loadPlanForScenario("payment-due");
  assert.equal(plan.current.lifecycle, "payment-due");
  assert.ok(plan.current.invoicePaymentUrl);
  process.env.BILLING_DEV_MOCK = "payment-due";
  const balance = await loadAccountBalance(
    { appToken: "t", currency: "usd", kubeconfig: "k" },
    mockFetch
  );
  assert.ok(balance.microUnits < 0, "debt scenario shows a negative balance");
});

test("pending-upgrade derives the queued plan change", async () => {
  const plan = await loadPlanForScenario("pending-upgrade");
  assert.equal(plan.current.lifecycle, "pending-upgrade");
  assert.equal(plan.pendingUpgrade?.planName, "Pro");
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

test("write endpoints answer 501 instead of reaching upstream", async () => {
  process.env.BILLING_DEV_MOCK = "active";
  const response = await billingDevMockResponse(
    "/account/v1alpha1/workspace-subscription/pay",
    new Request("http://localhost/api/billing/subscription/pay", {
      body: "{}",
      method: "POST",
    })
  );
  assert.equal(response?.status, 501);
});

test("unknown scenarios fail loud instead of falling through", async () => {
  process.env.BILLING_DEV_MOCK = "dept";
  const response = await billingDevMockResponse(
    "/account/v1alpha1/regions",
    new Request("http://localhost/api/billing/regions")
  );
  assert.equal(response?.status, 500);
});
