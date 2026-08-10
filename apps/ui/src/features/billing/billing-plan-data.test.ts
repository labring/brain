import assert from "node:assert/strict";
import { test } from "node:test";

import {
  cancelSubscriptionInvoice,
  checkSubscriptionDowngrade,
  createBillingCardManagementSession,
  createSubscriptionPlanPayment,
  loadBillingPlanSnapshot,
  loadSubscriptionTransactionStatus,
  loadSubscriptionUpgradeQuote,
  SubscriptionPromotionCodeError,
  updateSubscriptionLifecycle,
} from "./billing-plan-data";

const NOW = new Date("2026-07-30T12:00:00Z");

const RESPONSES: Record<string, unknown> = {
  "/api/billing/card": {
    payment_method: {
      card: { brand: "visa", exp_month: 12, exp_year: 2028, last4: "4242" },
    },
    success: true,
  },
  "/api/billing/plans": {
    plans: [
      {
        AIQuota: 0,
        Description: "For personal projects",
        DowngradePlanList: [],
        ID: "plan-starter",
        MaxResources: JSON.stringify({ cpu: "1", memory: "2Gi" }),
        Name: "Starter",
        Order: 1,
        Prices: [{ BillingCycle: "1m", Price: 5_000_000 }],
        Tags: [],
        Traffic: 1024,
        UpgradePlanList: ["Pro", "Team"],
      },
      {
        AIQuota: 10,
        Description: "For growing workloads",
        DowngradePlanList: ["Starter"],
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
        UpgradePlanList: ["Team"],
      },
      {
        AIQuota: 40,
        Description: "For larger teams",
        DowngradePlanList: ["Starter", "Pro"],
        ID: "plan-team",
        MaxResources: JSON.stringify({ cpu: "12", memory: "24Gi" }),
        Name: "Team",
        Order: 3,
        Prices: [{ BillingCycle: "1m", Price: 50_000_000 }],
        Tags: [],
        Traffic: 8192,
        UpgradePlanList: [],
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
        ID: "invoice-1",
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

test("loads the verified account's Plan snapshot with workspace plan facts", async () => {
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
  assert.equal(snapshot.current.invoiceId, "invoice-1");
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
  assert.equal(snapshot.current.isPayg, false);
  assert.deepEqual(snapshot.card, {
    brand: "visa",
    expMonth: 12,
    expYear: 2028,
    last4: "4242",
  });
  assert.deepEqual(
    snapshot.plans.map((plan) => [plan.name, plan.isCurrent, plan.changeKind]),
    [
      ["Starter", false, "downgrade"],
      ["Pro", true, null],
      ["Team", false, "upgrade"],
    ]
  );
  assert.deepEqual(snapshot.plans[0]?.limits, {
    cpu: "1",
    memory: "2Gi",
    traffic: "1Gi",
  });
  assert.deepEqual(
    snapshot.workspaces.map((workspace) => ({
      lifecycle: workspace.lifecycle,
      name: workspace.name,
      priceMicroUnits: workspace.priceMicroUnits,
      renewalAt: workspace.renewalAt,
    })),
    [
      {
        lifecycle: "cancelling",
        name: "Workspace Alpha",
        priceMicroUnits: 20_000_000,
        renewalAt: "2026-08-31T00:00:00Z",
      },
      {
        lifecycle: "active",
        name: "Workspace Beta",
        priceMicroUnits: 5_000_000,
        renewalAt: "2026-08-31T00:00:00Z",
      },
    ]
  );

  assert.equal(requests.length, 7);
  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer apiVersion%3A%20v1");
    assert.equal(headers.get("X-Sealos-App-Token"), "desktop-app-token");
  }

  const workspacesRequest = requests.find(
    (request) => request.url === "/api/billing/workspaces"
  );
  assert.deepEqual(JSON.parse(String(workspacesRequest?.init?.body)), {
    endTime: "2026-07-30T12:00:00.000Z",
    startTime: "2026-06-29T12:00:00.000Z",
    type: 0,
  });
});

test("plans outside the transition lists stay selectable as upgrades", async () => {
  const plansResponse = RESPONSES["/api/billing/plans"] as {
    plans: Record<string, unknown>[];
  };
  const loadWithTransitions = (transitionLists: "absent" | "restricted") => {
    const plans = plansResponse.plans.map((plan) => {
      if (plan.Name !== "Pro") {
        return plan;
      }
      const currentPlan = { ...plan };
      if (transitionLists === "absent") {
        Reflect.deleteProperty(currentPlan, "DowngradePlanList");
        Reflect.deleteProperty(currentPlan, "UpgradePlanList");
      } else {
        currentPlan.DowngradePlanList = [];
        currentPlan.UpgradePlanList = [];
      }
      return currentPlan;
    });
    return loadBillingPlanSnapshot(
      {
        appToken: "desktop-app-token",
        kubeconfig: "apiVersion: v1",
        workspace: "workspace-a",
      },
      {
        fetch: (input) => {
          const url = input.toString();
          return Promise.resolve(
            Response.json(
              url === "/api/billing/plans" ? { plans } : RESPONSES[url]
            )
          );
        },
        now: () => NOW,
      }
    );
  };

  // Mirrors the legacy costcenter: the frontend never forbids a move on its
  // own — anything outside both lists submits as an upgrade and
  // account-service is the authority that rejects illegal transitions.
  const restrictedSnapshot = await loadWithTransitions("restricted");
  assert.deepEqual(
    restrictedSnapshot.plans.map((plan) => [plan.name, plan.changeKind]),
    [
      ["Starter", "upgrade"],
      ["Pro", null],
      ["Team", "upgrade"],
    ]
  );

  const fallbackSnapshot = await loadWithTransitions("absent");
  assert.deepEqual(
    fallbackSnapshot.plans.map((plan) => [plan.name, plan.changeKind]),
    [
      ["Starter", "upgrade"],
      ["Pro", null],
      ["Team", "upgrade"],
    ]
  );
});

test("a PAYG workspace treats every plan as a fresh subscription", async () => {
  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) => {
        const url = input.toString();
        if (url === "/api/billing/subscription") {
          return Promise.resolve(
            Response.json({ subscription: { type: "PAYG" } })
          );
        }
        if (url === "/api/billing/subscription/last-transaction") {
          return Promise.resolve(Response.json({}));
        }
        return Promise.resolve(Response.json(RESPONSES[url]));
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.isPayg, true);
  assert.equal(snapshot.current.canManage, true);
  assert.deepEqual(
    snapshot.plans.map((plan) => [plan.name, plan.isCurrent, plan.changeKind]),
    [
      ["Starter", false, "subscribe"],
      ["Pro", false, "subscribe"],
      ["Team", false, "subscribe"],
    ]
  );
});

test("a pending downgrade transaction surfaces as pendingDowngrade", async () => {
  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) => {
        const url = input.toString();
        if (url === "/api/billing/subscription/last-transaction") {
          return Promise.resolve(
            Response.json({
              transaction: {
                NewPlanName: "Starter",
                Operator: "downgraded",
                StartAt: "2026-08-31T00:00:00Z",
                Status: "pending",
              },
            })
          );
        }
        return Promise.resolve(Response.json(RESPONSES[url]));
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.pendingUpgrade, null);
  assert.deepEqual(snapshot.pendingDowngrade, {
    planName: "Starter",
    startsAt: "2026-08-31T00:00:00Z",
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

test("loads the exact prorated upgrade amount with a promotion code", async () => {
  let request: { init: RequestInit | undefined; url: string } | undefined;

  const quote = await loadSubscriptionUpgradeQuote(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      planName: "Team",
      promotionCode: "SAVE20",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        request = { init, url: input.toString() };
        return Promise.resolve(
          Response.json({
            amount: 7_500_000,
            has_discount: true,
            original_amount: 9_000_000,
            promotion_code: "SAVE20",
          })
        );
      },
    }
  );

  assert.deepEqual(quote, {
    amountMicroUnits: 7_500_000,
    discountMicroUnits: 1_500_000,
    hasDiscount: true,
    originalAmountMicroUnits: 9_000_000,
    promotionCode: "SAVE20",
  });
  assert.equal(request?.url, "/api/billing/subscription/upgrade-amount");
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    operator: "upgraded",
    payMethod: "stripe",
    period: "1m",
    planName: "Team",
    promotionCode: "SAVE20",
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("distinguishes unknown, expired, and exhausted promotion codes", async () => {
  for (const [status, kind] of [
    [404, "unknown"],
    [410, "expired"],
    [409, "exhausted"],
  ] as const) {
    await assert.rejects(
      loadSubscriptionUpgradeQuote(
        {
          appToken: "desktop-app-token",
          kubeconfig: "apiVersion: v1",
          planName: "Team",
          promotionCode: "NOPE",
          regionDomain: "us.example.test",
          workspace: "workspace-a",
        },
        {
          fetch: () =>
            Promise.resolve(
              Response.json({ error: `Promotion code ${kind}` }, { status })
            ),
        }
      ),
      (error) =>
        error instanceof SubscriptionPromotionCodeError && error.kind === kind
    );
  }
});

test("creates an upgrade checkout and retains its cancellation identifiers", async () => {
  let request: { init: RequestInit | undefined; url: string } | undefined;

  const checkout = await createSubscriptionPlanPayment(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      operator: "upgraded",
      planName: "Team",
      promotionCode: "SAVE20",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        request = { init, url: input.toString() };
        return Promise.resolve(
          Response.json({
            invoiceID: "invoice-1",
            payID: "payment-1",
            redirectUrl: "https://checkout.stripe.test/invoice-1",
            success: true,
          })
        );
      },
    }
  );

  assert.deepEqual(checkout, {
    invoiceId: "invoice-1",
    payId: "payment-1",
    redirectUrl: "https://checkout.stripe.test/invoice-1",
    success: true,
  });
  assert.equal(request?.url, "/api/billing/subscription/pay");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    operator: "upgraded",
    payMethod: "stripe",
    period: "1m",
    planName: "Team",
    promotionCode: "SAVE20",
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("cancels an unpaid upgrade invoice", async () => {
  let request: { init: RequestInit | undefined; url: string } | undefined;

  await cancelSubscriptionInvoice(
    {
      appToken: "desktop-app-token",
      invoiceId: "invoice-1",
      kubeconfig: "apiVersion: v1",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        request = { init, url: input.toString() };
        return Promise.resolve(
          Response.json({
            invoice_id: "invoice-1",
            message: "cancelled",
            success: true,
          })
        );
      },
    }
  );

  assert.equal(request?.url, "/api/billing/subscription/invoice-cancel");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    invoiceID: "invoice-1",
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("loads the latest subscription transaction status for payment waiting", async () => {
  let request: { init: RequestInit | undefined; url: string } | undefined;

  const transaction = await loadSubscriptionTransactionStatus(
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
            transaction: {
              ID: "transaction-1",
              NewPlanName: "Team",
              Operator: "upgraded",
              PayID: "payment-1",
              Status: "completed",
            },
          })
        );
      },
    }
  );

  assert.deepEqual(transaction, {
    id: "transaction-1",
    payId: "payment-1",
    planName: "Team",
    status: "completed",
  });
  assert.equal(request?.url, "/api/billing/subscription/last-transaction");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("blocks a downgrade when current usage exceeds the target plan", async () => {
  const result = await checkSubscriptionDowngrade(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      limits: {
        cpu: "1",
        memory: "4Gi",
        storage: "10Gi",
        traffic: "50Gi",
      },
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    },
    {
      fetch: () =>
        Promise.resolve(
          Response.json({
            quota: {
              hard: {},
              used: {
                "limits.cpu": "1500m",
                "limits.memory": "3Gi",
                "requests.storage": "12Gi",
                traffic: "25Gi",
              },
            },
          })
        ),
    }
  );

  assert.deepEqual(result, {
    allowed: false,
    exceededResources: [
      { label: "CPU", limit: "1", used: "1.5" },
      { label: "Storage", limit: "10Gi", used: "12Gi" },
    ],
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
