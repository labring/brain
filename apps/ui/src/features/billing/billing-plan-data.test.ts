import assert from "node:assert/strict";
import { test } from "node:test";

import { BillingRequestError } from "./billing-data-client";
import {
  cancelSubscriptionInvoice,
  checkSubscriptionDowngrade,
  createBillingCardManagementSession,
  createSubscriptionPlanPayment,
  loadBillingPlanSnapshot,
  loadSubscriptionTransactionStatus,
  loadSubscriptionUpgradeQuote,
  loadWorkspaceSubscriptionSummary,
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
        AIQuota: 20_000_000,
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
        AIQuota: 40_000_000,
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
    current: {
      accountSvc: "account-service.account-system.svc:2333",
      domain: "us.example.test",
      name: { en: "United States", zh: "US" },
      uid: "region-us",
    },
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
  assert.equal(snapshot.current.warningStage, "cancelling");
  // Still inside the paid period, so the deadline is the suspension date —
  // the period end itself, with no deletion grace added.
  assert.equal(snapshot.current.warningDeadlineAt, "2026-08-31T00:00:00.000Z");
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

test("a draft invoice without a hosted payment URL keeps the Plan snapshot loadable", async () => {
  // Stripe mints hosted_invoice_url only at finalization; during the draft
  // window InvoiceInfo arrives with the URL key absent entirely.
  const responses: Record<string, unknown> = {
    ...RESPONSES,
    "/api/billing/subscription": {
      subscription: {
        CancelAtPeriodEnd: false,
        CurrentPeriodEndAt: "2026-08-31T00:00:00Z",
        InvoiceInfo: { ID: "invoice-draft" },
        PayMethod: "stripe",
        PlanName: "Pro",
        RegionDomain: "us.example.test",
        Status: "DEBT",
        Workspace: "workspace-a",
        role: "OWNER",
        type: "SUBSCRIPTION",
      },
    },
  };

  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) =>
        Promise.resolve(Response.json(responses[input.toString()])),
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.invoiceId, "invoice-draft");
  assert.equal(snapshot.current.invoicePaymentUrl, null);
  assert.equal(snapshot.current.lifecycle, "payment-due");
});

test("expiry statuses outrank a pending cancellation", async () => {
  // A cancelled subscription that has since expired: the deletion pipeline
  // must surface as payment-due, not linger on "cancelling".
  const responses: Record<string, unknown> = {
    ...RESPONSES,
    "/api/billing/subscription": {
      subscription: {
        CancelAtPeriodEnd: true,
        CurrentPeriodEndAt: "2026-07-20T00:00:00Z",
        ExpireAt: "2026-07-20T00:00:00Z",
        PayMethod: "stripe",
        PlanName: "Pro",
        RegionDomain: "us.example.test",
        Status: "DEBT_PRE_DELETION",
        Workspace: "workspace-a",
        role: "OWNER",
        type: "SUBSCRIPTION",
      },
    },
  };

  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) =>
        Promise.resolve(Response.json(responses[input.toString()])),
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.lifecycle, "payment-due");
  assert.equal(snapshot.current.warningStage, "deletion-imminent");
  // Expiry (2026-07-20) plus the platform's 14-day deletion grace.
  assert.equal(snapshot.current.warningDeadlineAt, "2026-08-03T00:00:00.000Z");
});

test("keeps core Plan data available when auxiliary requests fail", async () => {
  const unavailablePaths = new Set([
    "/api/billing/card",
    "/api/billing/subscription/last-transaction",
    "/api/billing/subscriptions",
    "/api/billing/workspaces",
  ]);

  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) => {
        const url = input.toString();
        if (unavailablePaths.has(url)) {
          return Promise.resolve(
            Response.json({ error: "temporarily unavailable" }, { status: 503 })
          );
        }
        return Promise.resolve(Response.json(RESPONSES[url]));
      },
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.planName, "Pro");
  assert.equal(snapshot.current.lifecycle, "cancelling");
  assert.deepEqual(snapshot.availability, {
    card: "unavailable",
    transaction: "unavailable",
    workspaces: "unavailable",
  });
  assert.equal(snapshot.card, null);
  assert.equal(snapshot.pendingDowngrade, null);
  assert.equal(snapshot.pendingUpgrade, null);
  assert.deepEqual(snapshot.workspaces, []);
});

function loadSnapshotWithSubscription(
  overrides: Record<string, unknown>,
  extraResponses: Record<string, unknown> = {}
) {
  const responses: Record<string, unknown> = {
    ...RESPONSES,
    "/api/billing/subscription": {
      subscription: {
        ...(
          RESPONSES["/api/billing/subscription"] as {
            subscription: Record<string, unknown>;
          }
        ).subscription,
        CancelAtPeriodEnd: false,
        ...overrides,
      },
    },
    ...extraResponses,
  };
  return loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) =>
        Promise.resolve(Response.json(responses[input.toString()])),
      now: () => NOW,
    }
  );
}

test("fails closed for unknown subscription statuses", async () => {
  const snapshot = await loadSnapshotWithSubscription({
    Status: "PAUSED_BY_PROVIDER",
  });

  assert.equal(snapshot.current.lifecycle, "unavailable");
  assert.ok(
    snapshot.plans.every((plan) => plan.isCurrent || plan.changeKind == null)
  );
});

test("presents a deleted subscription as the subscribable-again PAYG shape", async () => {
  // AIM-252: a DELETED record is not a Workspace Subscription — the
  // workspace is PAYG and may subscribe anew, with no stale plan, period,
  // or invoice facts leaking through.
  const snapshot = await loadSnapshotWithSubscription({ Status: "DELETED" });

  assert.equal(snapshot.current.lifecycle, "active");
  assert.equal(snapshot.current.isPayg, true);
  assert.equal(snapshot.current.planName, "PAYG");
  assert.equal(snapshot.current.canManage, true);
  assert.equal(snapshot.current.warningStage, null);
  assert.equal(snapshot.current.invoiceId, null);
  assert.equal(snapshot.current.invoicePaymentUrl, null);
  assert.equal(snapshot.current.priceMicroUnits, 0);
  assert.deepEqual(
    snapshot.plans.map((plan) => [plan.name, plan.isCurrent, plan.changeKind]),
    [
      ["Starter", false, "subscribe"],
      ["Pro", false, "subscribe"],
      ["Team", false, "subscribe"],
    ]
  );
});

test("keeps payment authority role-gated for a deleted subscription", async () => {
  // Subscription state and payment authority are orthogonal: the record's
  // role survives normalization, so only the OWNER manages payments.
  const snapshot = await loadSnapshotWithSubscription({
    Status: "DELETED",
    role: "DEVELOPER",
  });

  assert.equal(snapshot.current.lifecycle, "active");
  assert.equal(snapshot.current.isPayg, true);
  assert.equal(snapshot.current.canManage, false);
});

test("reports a deleted workspace row as PAYG in the workspace list", async () => {
  const snapshot = await loadSnapshotWithSubscription(
    {},
    {
      "/api/billing/subscriptions": {
        subscriptions: [
          (
            RESPONSES["/api/billing/subscriptions"] as {
              subscriptions: Record<string, unknown>[];
            }
          ).subscriptions[0],
          {
            CancelAtPeriodEnd: false,
            CurrentPeriodEndAt: "2026-06-30T00:00:00Z",
            PayMethod: "stripe",
            PlanName: "Starter",
            RegionDomain: "us.example.test",
            Status: "DELETED",
            Workspace: "workspace-b",
          },
        ],
      },
    }
  );

  const deletedRow = snapshot.workspaces.find(
    (workspace) => workspace.id === "workspace-b"
  );
  assert.deepEqual(deletedRow, {
    id: "workspace-b",
    isCurrent: false,
    lifecycle: "active",
    name: "Workspace Beta",
    planName: "PAYG",
    priceMicroUnits: null,
    renewalAt: null,
  });
});

test("treats a paused Free subscription as plan-change ready", async () => {
  // PAUSED is the healthy state of a no-trial Free workspace; the platform
  // creates those with CancelAtPeriodEnd already true.
  const responses: Record<string, unknown> = {
    ...RESPONSES,
    "/api/billing/subscription": {
      subscription: {
        ...(
          RESPONSES["/api/billing/subscription"] as {
            subscription: Record<string, unknown>;
          }
        ).subscription,
        CancelAtPeriodEnd: true,
        PlanName: "Free",
        Status: "PAUSED",
      },
    },
    "/api/billing/subscription/last-transaction": {},
  };
  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) =>
        Promise.resolve(Response.json(responses[input.toString()])),
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.lifecycle, "active");
  assert.equal(snapshot.current.warningStage, null);
  assert.ok(snapshot.plans.every((plan) => plan.changeKind != null));
});

test("keeps a paused subscription's pending upgrade authoritative", async () => {
  const responses: Record<string, unknown> = {
    ...RESPONSES,
    "/api/billing/subscription": {
      subscription: {
        ...(
          RESPONSES["/api/billing/subscription"] as {
            subscription: Record<string, unknown>;
          }
        ).subscription,
        CancelAtPeriodEnd: true,
        PlanName: "Free",
        Status: "PAUSED",
      },
    },
  };
  const snapshot = await loadBillingPlanSnapshot(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input) =>
        Promise.resolve(Response.json(responses[input.toString()])),
      now: () => NOW,
    }
  );

  assert.equal(snapshot.current.lifecycle, "pending-upgrade");
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
  assert.equal(snapshot.current.workspace, "workspace-a");
  assert.deepEqual(
    snapshot.plans.map((plan) => [plan.name, plan.isCurrent, plan.changeKind]),
    [
      ["Starter", false, "subscribe"],
      ["Pro", false, "subscribe"],
      ["Team", false, "subscribe"],
    ]
  );
});

test("PAYG debt statuses enter the payment-due lifecycle", async () => {
  for (const status of [
    "DEBT",
    "DEBT_PRE_DELETION",
    "DEBT_FINAL_DELETION",
  ] as const) {
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
              Response.json({ subscription: { Status: status, type: "PAYG" } })
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
    assert.equal(snapshot.current.lifecycle, "payment-due", status);
    assert.equal(
      snapshot.current.warningStage,
      status === "DEBT" ? "expired" : "deletion-imminent",
      status
    );
  }
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
    kind: "quote",
    quote: {
      amountMicroUnits: 7_500_000,
      discountMicroUnits: 1_500_000,
      hasDiscount: true,
      originalAmountMicroUnits: 9_000_000,
      promotionCode: "SAVE20",
    },
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

test("returns a pending subscription upgrade with and without a promotion code", async () => {
  for (const promotionCode of [undefined, "SAVE20"] as const) {
    const result = await loadSubscriptionUpgradeQuote(
      {
        appToken: "desktop-app-token",
        kubeconfig: "apiVersion: v1",
        planName: "Team",
        promotionCode,
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      },
      {
        fetch: () =>
          Promise.resolve(
            Response.json(
              {
                error: "An unpaid upgrade already exists.",
                pending_upgrade: {
                  amount_due: 7_500_000,
                  created_at: 1_753_600_000,
                  currency: "usd",
                  discount_amount: 1_500_000,
                  has_discount: true,
                  invoice_id: "invoice-1",
                  original_amount: 9_000_000,
                  payment_id: "payment-1",
                  payment_url: "https://checkout.stripe.test/invoice-1",
                  plan_name: "Team",
                  promotion_code: "SPRING15",
                  status: "open",
                  total_amount: 7_500_000,
                },
              },
              { status: 409 }
            )
          ),
      }
    );

    assert.deepEqual(result, {
      kind: "pending-upgrade",
      pendingUpgrade: {
        amountDueMicroUnits: 7_500_000,
        createdAtSeconds: 1_753_600_000,
        currency: "usd",
        discountMicroUnits: 1_500_000,
        hasDiscount: true,
        invoiceId: "invoice-1",
        originalAmountMicroUnits: 9_000_000,
        paymentId: "payment-1",
        paymentUrl: "https://checkout.stripe.test/invoice-1",
        planName: "Team",
        promotionCode: "SPRING15",
        status: "open",
        totalAmountMicroUnits: 7_500_000,
      },
    });
  }
});

test("does not classify invalid pending recovery as an exhausted promotion code", async () => {
  await assert.rejects(
    loadSubscriptionUpgradeQuote(
      {
        appToken: "desktop-app-token",
        kubeconfig: "apiVersion: v1",
        planName: "Team",
        promotionCode: "SAVE20",
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      },
      {
        fetch: () =>
          Promise.resolve(
            Response.json(
              {
                code: "invalid_pending_upgrade",
                error:
                  "The existing subscription payment could not be recovered.",
              },
              { status: 409 }
            )
          ),
      }
    ),
    (error) =>
      error instanceof BillingRequestError &&
      error.status === 409 &&
      error.message ===
        "The existing subscription payment could not be recovered."
  );
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
    operator: "upgraded",
    payId: "payment-1",
    planName: "Team",
    startAt: null,
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

function loadSummaryWithSubscription(overrides: Record<string, unknown>) {
  const responses: Record<string, unknown> = {
    "/api/billing/regions": RESPONSES["/api/billing/regions"],
    "/api/billing/subscription": {
      subscription: {
        ...(
          RESPONSES["/api/billing/subscription"] as {
            subscription: Record<string, unknown>;
          }
        ).subscription,
        CancelAtPeriodEnd: false,
        ...overrides,
      },
    },
  };
  const requests: Array<{ init: RequestInit | undefined; url: string }> = [];
  const summary = loadWorkspaceSubscriptionSummary(
    {
      appToken: "desktop-app-token",
      kubeconfig: "apiVersion: v1",
      workspace: "workspace-a",
    },
    {
      fetch: (input, init) => {
        const url = input.toString();
        requests.push({ init, url });
        const response = responses[url];
        assert.notEqual(
          response,
          undefined,
          `response fixture exists for ${url}`
        );
        return Promise.resolve(Response.json(response));
      },
    }
  );
  return { requests, summary };
}

test("loads the sidebar subscription summary with only region-addressed reads", async () => {
  const { requests, summary } = loadSummaryWithSubscription({});

  assert.deepEqual(await summary, {
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    isActiveFreeTrial: false,
    isPayg: false,
    lifecycle: "active",
    planName: "Pro",
    recoveryVoice: "renew",
    role: "OWNER",
    warningDeadlineAt: null,
    warningStage: null,
  });
  assert.deepEqual(
    requests.map((request) => request.url),
    ["/api/billing/regions", "/api/billing/subscription"]
  );
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("the sidebar summary reports an Active Free Trial and its period end", async () => {
  const { summary } = loadSummaryWithSubscription({
    PlanName: "Free",
    Status: "NORMAL",
  });

  assert.deepEqual(await summary, {
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    isActiveFreeTrial: true,
    isPayg: false,
    lifecycle: "active",
    planName: "Free",
    recoveryVoice: "resubscribe",
    role: "OWNER",
    warningDeadlineAt: null,
    warningStage: null,
  });
});

test("the sidebar summary derives cancelling and payment-due lifecycles", async () => {
  const cancelling = await loadSummaryWithSubscription({
    CancelAtPeriodEnd: true,
  }).summary;
  assert.equal(cancelling.lifecycle, "cancelling");

  const paymentDue = await loadSummaryWithSubscription({ Status: "debt" })
    .summary;
  assert.equal(paymentDue.lifecycle, "payment-due");
});

test("the sidebar summary presents a deleted subscription as PAYG", async () => {
  const { summary } = loadSummaryWithSubscription({ Status: "DELETED" });

  assert.deepEqual(await summary, {
    currentPeriodEndAt: "",
    isActiveFreeTrial: false,
    isPayg: true,
    lifecycle: "active",
    planName: "PAYG",
    recoveryVoice: "renew",
    role: "OWNER",
    warningDeadlineAt: null,
    warningStage: null,
  });
});

test("the sidebar summary carries the Deletion Countdown's stage and derived deadline", async () => {
  // ADR-0063: the status hint states the deletion date exactly as the Plan
  // view does — expiry plus the fixed grace, derived client-side.
  const { summary } = loadSummaryWithSubscription({
    CurrentPeriodEndAt: "2026-08-20T00:00:00Z",
    Status: "DEBT",
  });
  const result = await summary;
  assert.equal(result.lifecycle, "payment-due");
  assert.equal(result.warningStage, "expired");
  assert.equal(result.warningDeadlineAt, "2026-09-03T00:00:00.000Z");
  assert.equal(result.recoveryVoice, "renew");
});
