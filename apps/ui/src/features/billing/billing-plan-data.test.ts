import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createBillingCardManagementSession,
  loadBillingPlanSnapshot,
  updateSubscriptionLifecycle,
} from "./billing-plan-data";

const NOW = new Date("2026-07-30T12:00:00Z");

const RESPONSES: Record<string, unknown> = {
  "/api/billing/card": {
    payment_method: { card: { brand: "visa", last4: "4242" } },
    success: true,
  },
  "/api/billing/payments": {
    payments: [
      {
        Amount: 10_000_000,
        ID: "payment-1",
        Operator: "renewed",
        PlanName: "Pro",
        Time: "2026-07-12T00:00:00Z",
        Type: "SUBSCRIPTION",
        Workspace: "workspace-a",
      },
      {
        Amount: 2_500_000,
        ID: "payment-2",
        Operator: "upgraded",
        PlanName: "Pro",
        Time: "2026-07-20T00:00:00Z",
        Type: "SUBSCRIPTION",
        Workspace: "workspace-a",
      },
      {
        Amount: 3_000_000,
        ID: "payment-3",
        Operator: "renewed",
        PlanName: "Starter",
        Time: "2026-07-21T00:00:00Z",
        Type: "SUBSCRIPTION",
        Workspace: "workspace-b",
      },
    ],
  },
  "/api/billing/plans": {
    plans: [
      {
        AIQuota: 0,
        Description: "For personal projects",
        ID: "plan-starter",
        MaxResources: JSON.stringify({ cpu: "1", memory: "2Gi" }),
        Name: "Starter",
        Order: 1,
        Prices: [{ BillingCycle: "1m", Price: 5_000_000 }],
        Tags: [],
        Traffic: 1024,
      },
      {
        AIQuota: 10,
        Description: "For growing workloads",
        ID: "plan-pro",
        MaxResources: JSON.stringify({
          cpu: "4",
          memory: "8Gi",
          storage: "50Gi",
        }),
        Name: "Pro",
        Order: 2,
        Prices: [{ BillingCycle: "1m", Price: 20_000_000 }],
        Tags: [],
        Traffic: 4096,
      },
      {
        AIQuota: 40,
        Description: "For larger teams",
        ID: "plan-team",
        MaxResources: JSON.stringify({ cpu: "12", memory: "24Gi" }),
        Name: "Team",
        Order: 3,
        Prices: [{ BillingCycle: "1m", Price: 50_000_000 }],
        Tags: [],
        Traffic: 8192,
      },
    ],
  },
  "/api/billing/regions": {
    regions: [
      {
        accountSvc: "account-service.account-system.svc:2333",
        domain: "us.example.test",
        name: { en: "United States", zh: "US" },
        uid: "region-us",
      },
    ],
  },
  "/api/billing/subscription": {
    subscription: {
      CancelAtPeriodEnd: true,
      CurrentPeriodEndAt: "2026-08-31T00:00:00Z",
      ExpireAt: "2026-08-31T00:00:00Z",
      InvoiceInfo: {
        PaymentUrl: "https://payments.example.test/invoice-1",
      },
      PayMethod: "stripe",
      PlanName: "Pro",
      RegionDomain: "us.example.test",
      Status: "Normal",
      Workspace: "workspace-a",
      role: "OWNER",
      type: "SUBSCRIPTION",
    },
  },
  "/api/billing/subscription/last-transaction": {
    transaction: {
      NewPlanName: "Team",
      Operator: "upgraded",
      StartAt: "2026-08-31T00:00:00Z",
      Status: "pending",
    },
  },
  "/api/billing/subscriptions": {
    subscriptions: [
      {
        CancelAtPeriodEnd: true,
        CurrentPeriodEndAt: "2026-08-31T00:00:00Z",
        PayMethod: "stripe",
        PlanName: "Pro",
        RegionDomain: "us.example.test",
        Status: "Normal",
        Workspace: "workspace-a",
      },
      {
        CancelAtPeriodEnd: false,
        CurrentPeriodEndAt: "2026-08-31T00:00:00Z",
        PayMethod: "stripe",
        PlanName: "Starter",
        RegionDomain: "us.example.test",
        Status: "Normal",
        Workspace: "workspace-b",
      },
    ],
  },
  "/api/billing/workspaces": {
    data: [
      ["workspace-a", "Workspace Alpha"],
      ["workspace-b", "Workspace Beta"],
    ],
  },
};

test("loads the verified account's Plan snapshot and aggregates recent workspace spend", async () => {
  const requests: Array<{ init: RequestInit | undefined; url: string }> = [];

  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        const url = input.toString();
        requests.push({ init, url });
        const response = RESPONSES[url];
        assert.notEqual(
          response,
          undefined,
          `response fixture exists for ${url}`
        );
        return Promise.resolve(Response.json(response));
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.planName, "Pro");
  assert.equal(snapshot.current.lifecycle, "cancelling");
  assert.equal(snapshot.current.priceMicroUnits, 20_000_000);
  assert.deepEqual(snapshot.current.resources.slice(0, 3), [
    { label: "CPU", value: "4" },
    { label: "Memory", value: "8Gi" },
    { label: "Storage", value: "50Gi" },
  ]);
  assert.deepEqual(snapshot.pendingUpgrade, {
    planName: "Team",
    startsAt: "2026-08-31T00:00:00Z",
  });
  assert.deepEqual(snapshot.card, { brand: "visa", last4: "4242" });
  assert.deepEqual(
    snapshot.plans.map((plan) => [plan.name, plan.isCurrent]),
    [
      ["Starter", false],
      ["Pro", true],
      ["Team", false],
    ]
  );
  assert.deepEqual(
    snapshot.workspaces.map((workspace) => ({
      lifecycle: workspace.lifecycle,
      name: workspace.name,
      recentSpendMicroUnits: workspace.recentSpendMicroUnits,
    })),
    [
      {
        lifecycle: "cancelling",
        name: "Workspace Alpha",
        recentSpendMicroUnits: 12_500_000,
      },
      {
        lifecycle: "active",
        name: "Workspace Beta",
        recentSpendMicroUnits: 3_000_000,
      },
    ]
  );

  assert.equal(requests.length, 8);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
    assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  }

  const paymentRequest = requests.find(
    (request) => request.url === "/api/billing/payments"
  );
  assert.deepEqual(JSON.parse(String(paymentRequest?.init?.body)), {
    endTime: "2026-07-30T12:00:00.000Z",
    startTime: "2026-06-29T12:00:00.000Z",
  });
});

test("updates a subscription lifecycle with verified personal-resource credentials", async () => {
  const requests: Array<{ init: RequestInit | undefined; url: string }> = [];

  await updateSubscriptionLifecycle(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      operator: "canceled",
      payMethod: "stripe",
      planName: "Pro",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        requests.push({ init, url: input.toString() });
        return Promise.resolve(Response.json({ success: true }));
      },
    }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "/api/billing/subscription/pay");
  assert.equal(requests[0]?.init?.method, "POST");
  const headers = new Headers(requests[0]?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
  assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    operator: "canceled",
    payMethod: "stripe",
    planName: "Pro",
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("creates a hosted card management session with verified credentials", async () => {
  let request: { init: RequestInit | undefined; url: string } | undefined;

  const managementUrl = await createBillingCardManagementSession(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        request = { init, url: input.toString() };
        return Promise.resolve(
          Response.json({
            success: true,
            url: "https://checkout.stripe.test/setup-session",
          })
        );
      },
    }
  );

  assert.equal(managementUrl, "https://checkout.stripe.test/setup-session");
  assert.equal(request?.url, "/api/billing/card/manage");
  assert.equal(request?.init?.method, "POST");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
  assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});
