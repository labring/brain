import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  type BillingDevScenario,
  formatBillingDevMockCookie,
  parseBillingDevMockCookie,
} from "@/features/billing/dev-mock-cookie";
import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

/**
 * Billing dev-mock fixtures (dev and demo builds only, permanent dev
 * infrastructure — `NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image).
 *
 * The dev-tweaks pane (⌃⌥T → "Billing mock") writes a session cookie
 * (`dev-mock-cookie.ts` documents the grammar); while it names a scenario,
 * every `/api/billing/*` proxy answers from these fixtures instead of the
 * account service, so the real /billing pages can be exercised in any
 * subscription state without credentials.
 *
 * Reads come from `FIXTURES`, pure functions of (body, scenario, workspace).
 * Writes are scenario transitions: a successful mutation answers with
 * `Set-Cookie` moving the scenario (e.g. pay/canceled: active → cancelling),
 * so after the client revalidates, every read shows the new state and whole
 * flows can be clicked through. `active`'s last-transaction reports the mock
 * checkout as completed so the checkout dialog's payment poll settles.
 * Writes outside `WRITE_FIXTURES`' transition tables answer 501 so a mock
 * session can never mutate a real account.
 */

interface FixtureContext {
  body: Record<string, unknown>;
  scenario: BillingDevScenario;
  workspace: string;
}

const REGION_DOMAIN = "mock.sealos.run";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const MOCK_CHECKOUT_PAY_ID = "pay-mock-checkout";
const MOCK_CHECKOUT_INVOICE_ID = "inv-mock-checkout";
const MOCK_WORKSPACES = {
  cancelling: "ns-mock-cancel",
  debt: "ns-mock-debt",
  payg: "ns-mock-payg",
  pro: "ns-mock-pro",
} as const;

/** Scenarios whose account sits in debt (deductions outrun the balance). */
const DEBT_SCENARIOS = new Set<BillingDevScenario>([
  "payg-debt",
  "payment-due",
  "payment-due-deletion",
  "payment-due-final",
]);

/** Scenarios with no saved card: PAYG modes and never-paid Free plans. */
const CARDLESS_SCENARIOS = new Set<BillingDevScenario>([
  "active-balance",
  "free",
  "paused",
  "payg",
  "payg-debt",
]);

/** Scenarios with no subscription transaction history. */
const TRANSACTIONLESS_SCENARIOS = new Set<BillingDevScenario>([
  "free",
  "paused",
  "payg",
  "payg-debt",
]);

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_IN_MILLISECONDS).toISOString();
}

function defaultWorkspace(): string {
  try {
    const decoded = decodeURIComponent(
      process.env.NEXT_PUBLIC_DEV_ENCODED_KUBECONFIG ?? ""
    ).trim();
    return namespaceFromKubeconfigText(decoded) ?? "ns-mock";
  } catch {
    return "ns-mock";
  }
}

const MOCK_INVOICE_INFO = {
  ID: "inv-mock-1",
  PaymentUrl: "https://billing.example.com/invoice/inv-mock-1",
};

function subscriptionPayload(
  scenario: BillingDevScenario,
  workspace: string
): Record<string, unknown> {
  if (scenario === "payg") {
    // The upstream embeds a nil subscription and serializes only the type.
    return { type: "PAYG" };
  }
  if (scenario === "payg-debt") {
    // A PAYG workspace in debt: still no subscription row, so the status
    // arrives without any period timestamps to derive dates from.
    return { Status: "DEBT", type: "PAYG" };
  }
  // The upstream keeps ExpireAt >= CurrentPeriodEndAt and its Stripe path
  // sets them equal, so the fixtures mirror that instead of null.
  const periodEnd = daysFromNow(12);
  const base = {
    CancelAtPeriodEnd: false,
    CurrentPeriodEndAt: periodEnd,
    ExpireAt: periodEnd,
    PayMethod: "stripe",
    PlanName: "Hobby",
    RegionDomain: REGION_DOMAIN,
    Status: "NORMAL",
    Workspace: workspace,
    role: "OWNER",
    type: "SUBSCRIPTION",
  };
  switch (scenario) {
    case "active-balance":
      return { ...base, PayMethod: "balance" };
    case "cancelling":
      return { ...base, CancelAtPeriodEnd: true };
    // The platform creates Free subscriptions with CancelAtPeriodEnd already
    // true; a trial runs a period, a paused (no-trial) Free has none.
    case "free": {
      const trialEnd = daysFromNow(10);
      return {
        ...base,
        CancelAtPeriodEnd: true,
        CurrentPeriodEndAt: trialEnd,
        ExpireAt: trialEnd,
        PlanName: "Free",
      };
    }
    case "paused":
      return {
        ...base,
        CancelAtPeriodEnd: true,
        CurrentPeriodEndAt: "",
        ExpireAt: null,
        PlanName: "Free",
        Status: "PAUSED",
      };
    case "deleted": {
      const endedAt = daysFromNow(-30);
      return {
        ...base,
        CurrentPeriodEndAt: endedAt,
        ExpireAt: endedAt,
        Status: "DELETED",
      };
    }
    // The database serializes a NULL status as "" — the shape production
    // actually produced, and what the client fails closed on.
    case "status-unknown":
      return { ...base, Status: "" };
    // Debt scenarios expire in the past: the upstream only reports DEBT*
    // once CurrentPeriodEndAt has passed, and the UI derives the resource
    // deletion date (expiry + 14 days) from it.
    case "payment-due": {
      const expiredAt = daysFromNow(-2);
      return {
        ...base,
        CurrentPeriodEndAt: expiredAt,
        ExpireAt: expiredAt,
        InvoiceInfo: MOCK_INVOICE_INFO,
        Status: "DEBT",
      };
    }
    case "payment-due-deletion": {
      const expiredAt = daysFromNow(-8);
      return {
        ...base,
        CurrentPeriodEndAt: expiredAt,
        ExpireAt: expiredAt,
        InvoiceInfo: MOCK_INVOICE_INFO,
        Status: "DEBT_PRE_DELETION",
      };
    }
    // Past the 14-day grace: the derived deletion date is already behind us.
    case "payment-due-final": {
      const expiredAt = daysFromNow(-16);
      return {
        ...base,
        CurrentPeriodEndAt: expiredAt,
        ExpireAt: expiredAt,
        InvoiceInfo: MOCK_INVOICE_INFO,
        Status: "DEBT_FINAL_DELETION",
      };
    }
    default:
      return base;
  }
}

function subscriptionListPayload(context: FixtureContext): unknown[] {
  if (context.scenario === "payg" || context.scenario === "payg-debt") {
    return [];
  }
  const current = subscriptionPayload(context.scenario, context.workspace);
  if (context.scenario !== "mixed-workspaces") {
    return [current];
  }
  return [
    current,
    {
      ...subscriptionPayload("cancelling", MOCK_WORKSPACES.cancelling),
      PlanName: "Hobby",
    },
    {
      ...subscriptionPayload("payment-due", MOCK_WORKSPACES.debt),
      PlanName: "Pro",
    },
    { ...subscriptionPayload("active", MOCK_WORKSPACES.pro), PlanName: "Pro" },
  ];
}

function namespacesPayload(context: FixtureContext): [string, string][] {
  const rows: [string, string][] = [
    [context.workspace, "Main workspace"],
    [MOCK_WORKSPACES.payg, "Sandbox"],
  ];
  if (context.scenario === "mixed-workspaces") {
    rows.push(
      [MOCK_WORKSPACES.cancelling, "Legacy project"],
      [MOCK_WORKSPACES.debt, "Data pipeline"],
      [MOCK_WORKSPACES.pro, "Production"]
    );
  }
  return rows;
}

// Snapshot of the production catalog: `POST
// https://costcenter.usw-1.sealos.io/api/plan/list` (2026-08-10). Values are
// verbatim, including Free's empty Prices (not purchasable, never rendered as
// a card) and MaxResources arriving as a JSON string.
const PLAN_CATALOG = [
  {
    AIQuota: 0,
    Description:
      "Free 14-day trial with 4C4G/5G/1M for a Devbox and database, ideal for development testing",
    DowngradePlanList: [],
    ID: "8c839f25-22ba-4df6-adad-b12de0e75a49",
    MaxResources:
      '{"cpu": "4", "memory": "4Gi", "storage": "5Gi", "nodeports": "4"}',
    MaxSeats: 10,
    Name: "Free",
    Order: 1,
    Prices: [],
    Tags: ["base"],
    Traffic: 500,
    UpgradePlanList: [
      "Starter",
      "Hobby",
      "Standard",
      "Plus",
      "Pro",
      "Team",
      "Enterprise",
    ],
  },
  {
    AIQuota: 1_000_000,
    Description:
      "For beginners deploying existing images. Not for development work.",
    DowngradePlanList: [],
    ID: "61dc0438-ea7a-4ad5-a19d-dc838e4b25af",
    MaxResources:
      '{"cpu": "2", "memory": "2Gi", "storage": "10Gi", "nodeports": "4"}',
    MaxSeats: 10,
    Name: "Starter",
    Order: 2,
    Prices: [
      { BillingCycle: "1m", OriginalPrice: 33_500_000, Price: 7_000_000 },
    ],
    Tags: ["base"],
    Traffic: 10_240,
    UpgradePlanList: ["Hobby", "Standard", "Plus", "Pro", "Team", "Enterprise"],
  },
  {
    AIQuota: 3_000_000,
    Description:
      "For hobbyists building side projects. Not for production use.",
    DowngradePlanList: ["Starter"],
    ID: "28bfd5f9-3766-4fe6-95f8-0166a3e6adc4",
    MaxResources:
      '{"cpu": "4", "memory": "4Gi", "storage": "20Gi", "nodeports": "8"}',
    MaxSeats: 10,
    Name: "Hobby",
    Order: 3,
    Prices: [
      { BillingCycle: "1m", OriginalPrice: 69_500_000, Price: 25_000_000 },
    ],
    Tags: ["base"],
    Traffic: 51_200,
    UpgradePlanList: ["Standard", "Plus", "Pro", "Team", "Enterprise"],
  },
  {
    AIQuota: 8_000_000,
    Description:
      "For growing startups and apps. The ideal balance of performance and scale.",
    DowngradePlanList: ["Starter", "Hobby"],
    ID: "a528337a-083f-4a67-a603-84ff80f3c7c9",
    MaxResources:
      '{"cpu": "8", "memory": "16Gi", "storage": "50Gi", "nodeports": "16"}',
    MaxSeats: 20,
    Name: "Standard",
    Order: 4,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 128_000_000 }],
    Tags: ["base"],
    Traffic: 307_200,
    UpgradePlanList: ["Plus", "Pro", "Team", "Enterprise"],
  },
  {
    AIQuota: 9_000_000,
    Description:
      "For high-growth startups and demanding apps. Ideal for scaling workloads.",
    DowngradePlanList: ["Starter", "Hobby", "Standard"],
    ID: "f64768ae-4654-4f41-9289-bc7167c20fe9",
    MaxResources:
      '{"cpu": "12", "memory": "24Gi", "storage": "100Gi", "nodeports": "24"}',
    MaxSeats: 20,
    Name: "Plus",
    Order: 5,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 196_000_000 }],
    Tags: ["base"],
    Traffic: 512_000,
    UpgradePlanList: ["Pro", "Team", "Enterprise"],
  },
  {
    AIQuota: 10_000_000,
    Description:
      "For professional and team workloads. Expanded capacity for scaling projects.",
    DowngradePlanList: ["Starter", "Hobby", "Standard", "Plus"],
    ID: "9589afb1-0478-4bd6-9a7a-e58168154e01",
    MaxResources:
      '{"cpu": "16", "memory": "32Gi", "storage": "200Gi", "nodeports": "32"}',
    MaxSeats: 50,
    Name: "Pro",
    Order: 6,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 512_000_000 }],
    Tags: ["more"],
    Traffic: 1_048_576,
    UpgradePlanList: ["Team", "Enterprise"],
  },
  {
    AIQuota: 15_000_000,
    Description:
      "For large teams with compliance needs. Built for collaboration.",
    DowngradePlanList: ["Starter", "Hobby", "Standard", "Plus", "Pro"],
    ID: "7853aeb8-88b5-4e64-9781-f62ba2933795",
    MaxResources:
      '{"cpu": "64", "memory": "128Gi", "storage": "500Gi", "nodeports": "64"}',
    MaxSeats: 100,
    Name: "Team",
    Order: 7,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 2_030_000_000 }],
    Tags: ["base", "more"],
    Traffic: 3_145_728,
    UpgradePlanList: ["Enterprise"],
  },
  {
    AIQuota: 20_000_000,
    Description:
      "256C1T/1T/10T for enterprise-grade development and production",
    DowngradePlanList: ["Starter", "Hobby", "Standard", "Plus", "Pro", "Team"],
    ID: "92936924-0652-423e-a3f2-4c7c61f7f8f5",
    MaxResources:
      '{"cpu": "256", "memory": "1024Gi", "storage": "1024Gi", "nodeports": "128"}',
    MaxSeats: 500,
    Name: "Enterprise",
    Order: 8,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 12_451_000_000 }],
    Tags: ["base", "more"],
    Traffic: 10_485_760,
    UpgradePlanList: [],
  },
  {
    AIQuota: 0,
    Description: "https://go.sealos.in/contact-sales",
    DowngradePlanList: [],
    ID: "92936924-0652-423e-a3f2-4c7c61f7f8f9",
    MaxResources: '{"cpu": "256", "memory": "1024Gi", "storage": "1000Gi"}',
    MaxSeats: 5000,
    Name: "Customized",
    Order: 12,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 2_030_000_000 }],
    Tags: ["more"],
    Traffic: 10_485_760,
    UpgradePlanList: [],
  },
];

function costPointsPayload(): [number, number][] {
  const points: [number, number][] = [];
  for (let daysAgo = 30; daysAgo >= 0; daysAgo -= 1) {
    const at = new Date(Date.now() - daysAgo * DAY_IN_MILLISECONDS);
    at.setUTCHours(12, 0, 0, 0);
    points.push([
      Math.floor(at.getTime() / 1000),
      Math.round(420_000 + 260_000 * Math.sin(daysAgo / 3)),
    ]);
  }
  return points;
}

function paymentsPayload(context: FixtureContext): unknown[] {
  const subscriptionPayment = (id: string, operator: string, time: string) => ({
    Amount: 25_000_000,
    ID: id,
    Operator: operator,
    PlanName: "Hobby",
    Status: "PAID",
    Time: time,
    Type: "SUBSCRIPTION",
    Workspace: context.workspace,
  });
  return [
    subscriptionPayment("pay-mock-1", "renewed", daysFromNow(-2)),
    {
      Amount: 20_000_000,
      ID: "pay-mock-recharge",
      Operator: "",
      PlanName: "",
      Status: "PAID",
      Time: daysFromNow(-20),
      Type: "RECHARGE",
      Workspace: context.workspace,
    },
    subscriptionPayment("pay-mock-2", "renewed", daysFromNow(-32)),
    subscriptionPayment("pay-mock-3", "created", daysFromNow(-62)),
  ];
}

function paginationFromBody(body: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = typeof body.page === "number" && body.page >= 1 ? body.page : 1;
  const pageSize =
    typeof body.pageSize === "number" && body.pageSize >= 1
      ? body.pageSize
      : 10;
  return { page, pageSize };
}

function paginateItems<T>(
  items: readonly T[],
  page: number,
  pageSize: number
): { items: T[]; total: number; totalPage: number } {
  const total = items.length;
  const totalPage = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    totalPage,
  };
}

function appOverviewsPayload(context: FixtureContext): unknown[] {
  return [
    { amount: 6_820_000, appName: "brain-api", appType: 2 },
    { amount: 4_310_000, appName: "postgres-main", appType: 1 },
    {
      amount: 2_150_000,
      appName: "an-unreasonably-long-application-name-that-tests-truncation",
      appType: 2,
    },
    { amount: 1_930_000, appName: "devbox-experiments", appType: 10 },
    { amount: 1_120_000, appName: "asset-bucket", appType: 6 },
    { amount: 640_000, appName: "nightly-report", appType: 4 },
    { amount: 410_000, appName: "ai-proxy-gateway", appType: 11 },
    { amount: 90_000, appName: "redis-cache", appType: 1 },
  ].map((overview) => ({
    ...overview,
    namespace: context.workspace,
    regionDomain: REGION_DOMAIN,
  }));
}

function appCostsPayload(context: FixtureContext): unknown {
  const rows = [0, 1, 1, 2, 2, 3].map((daysAgo, index) => ({
    amount: 380_000 + index * 45_000,
    app_name: "brain-api",
    app_type: 2,
    namespace: context.workspace,
    order_id: `ord-mock-${index + 1}`,
    resources_by_type: [
      {
        amount: 380_000 + index * 45_000,
        app_name: "brain-api",
        app_type: 2,
        used: { 0: 1500, 1: 2048, 2: 10_240, 3: 120, 4: 1, 5: 0 },
        used_amount: {
          0: 180_000 + index * 20_000,
          1: 120_000 + index * 15_000,
          2: 52_000,
          3: 21_000,
          4: 7000,
          5: 0,
        },
      },
    ],
    time: daysFromNow(-daysAgo),
  }));
  const { page, pageSize } = paginationFromBody(context.body);
  const { items, total, totalPage } = paginateItems(rows, page, pageSize);
  return {
    app_costs: {
      costs: items,
      current_page: page,
      total_pages: totalPage,
      total_records: total,
    },
  };
}

const FIXTURES: Record<string, (context: FixtureContext) => unknown> = {
  "/account/v1alpha1/account": ({ scenario }) => ({
    account: DEBT_SCENARIOS.has(scenario)
      ? { Balance: 5_000_000, DeductionBalance: 11_320_000 }
      : { Balance: 128_000_000, DeductionBalance: 23_450_000 },
  }),
  // The production account service maps numbers to app-type codes (not
  // display names); the UI resolves codes to display names and icons.
  "/account/v1alpha1/cost-app-type-list": () => ({
    data: {
      1: "DB",
      2: "APP",
      3: "TERMINAL",
      4: "JOB",
      5: "OTHER",
      6: "OBJECT-STORAGE",
      7: "CLOUD-VM",
      8: "APP-STORE",
      9: "DB-BACKUP",
      10: "DEV-BOX",
      11: "LLM-TOKEN",
    },
  }),
  "/account/v1alpha1/cost-overview": (context) => {
    const overviews = appOverviewsPayload(context);
    const { page, pageSize } = paginationFromBody(context.body);
    const { items, total, totalPage } = paginateItems(
      overviews,
      page,
      pageSize
    );
    return { data: { overviews: items, total, totalPage } };
  },
  "/account/v1alpha1/costs": () => ({ data: { costs: costPointsPayload() } }),
  "/account/v1alpha1/costs/consumption": () => ({ amount: 18_230_000 }),
  "/account/v1alpha1/costs/workspace/app": appCostsPayload,
  "/account/v1alpha1/costs/workspace/consumption": (context) => ({
    amount: {
      [context.workspace]: 12_040_000,
      [MOCK_WORKSPACES.cancelling]: 1_260_000,
      [MOCK_WORKSPACES.debt]: 940_000,
      [MOCK_WORKSPACES.payg]: 3_100_000,
      [MOCK_WORKSPACES.pro]: 890_000,
    },
  }),
  "/account/v1alpha1/namespaces": (context) => ({
    data: namespacesPayload(context),
  }),
  "/account/v1alpha1/properties": () => ({
    data: {
      properties: [
        { name: "cpu", unit: "", unit_price: 44 },
        { name: "memory", unit: "", unit_price: 20 },
        { name: "storage", unit: "", unit_price: 2 },
        { name: "network", unit: "", unit_price: 780 },
        { name: "services.nodeports", unit: "", unit_price: 2000 },
        { name: "traffic", unit: "", unit_price: 0.000_08 },
        {
          alias: "NVIDIA RTX 4090",
          name: "gpu-nvidia-rtx-4090",
          unit: "",
          unit_price: 1_500_000,
        },
      ],
    },
  }),
  "/account/v1alpha1/regions": () => ({
    regions: [
      {
        domain: REGION_DOMAIN,
        name: { en: "Mock Region", zh: "模拟区域" },
        uid: "region-mock-1",
      },
    ],
  }),
  "/account/v1alpha1/workspace-subscription/card-info": ({ scenario }) => ({
    payment_method: CARDLESS_SCENARIOS.has(scenario)
      ? null
      : {
          card: {
            brand: "visa",
            exp_month: 12,
            exp_year: 2030,
            last4: "4242",
          },
        },
  }),
  "/account/v1alpha1/workspace-subscription/info": ({
    scenario,
    workspace,
  }) => ({
    subscription: subscriptionPayload(scenario, workspace),
  }),
  "/account/v1alpha1/workspace-subscription/last-transaction": ({
    scenario,
  }) => {
    if (scenario === "pending-upgrade") {
      return {
        transaction: {
          ID: "txn-mock-1",
          NewPlanName: "Pro",
          Operator: "upgraded",
          PayID: "pay-mock-upgrade",
          StartAt: daysFromNow(12),
          Status: "pending",
        },
      };
    }
    if (TRANSACTIONLESS_SCENARIOS.has(scenario)) {
      return {};
    }
    // A settled record matching the mock checkout ids: the checkout dialog
    // polls last-transaction for status "completed" + its payID, so landing
    // on a subscribed scenario after a mock payment closes the dialog.
    return {
      transaction: {
        ID: "txn-mock-settled",
        NewPlanName: "Hobby",
        Operator: "upgraded",
        PayID: MOCK_CHECKOUT_PAY_ID,
        StartAt: daysFromNow(-1),
        Status: "completed",
      },
    };
  },
  "/account/v1alpha1/workspace-subscription/list": (context) => ({
    subscriptions: subscriptionListPayload(context),
  }),
  "/account/v1alpha1/workspace-subscription/payment-list": (context) => ({
    payments: paymentsPayload(context),
  }),
  "/account/v1alpha1/workspace-subscription/plan-list": () => ({
    plans: PLAN_CATALOG,
  }),
  "/account/v1alpha1/workspace-subscription/upgrade-amount": ({ scenario }) => {
    if (scenario === "pending-upgrade") {
      return Response.json(
        {
          error: "An unpaid upgrade to Pro already exists.",
          pending_upgrade: {
            amount_due: 78_000_000,
            created_at: Math.floor(Date.now() / 1000),
            currency: "usd",
            invoice_id: "inv-123",
            payment_id: "pay-mock-upgrade",
            payment_url:
              "https://billing.example.com/invoice/mock-pending-upgrade",
            plan_name: "Pro",
            status: "open",
          },
        },
        { status: 409 }
      );
    }
    return {
      amount: 103_000_000,
      has_discount: false,
      original_amount: 103_000_000,
      promotion_code: "",
    };
  },
  // Mirrors the production Hobby plan's MaxResources (the scenarios' current
  // plan) so downgrade checks compare realistic numbers. PAYG modes have no
  // ai_quota key at all; Free plans carry one with the plan's zero allowance.
  "/account/v1alpha1/workspace/get-resource-quota": (context) => {
    const isPaygMode =
      context.scenario === "payg" || context.scenario === "payg-debt";
    const isFreePlan =
      context.scenario === "free" || context.scenario === "paused";
    return {
      quota: {
        hard: {
          "limits.cpu": "4",
          "limits.memory": "4Gi",
          "limits.nvidia.com/gpu": "0",
          "requests.storage": "20Gi",
          "services.nodeports": "8",
          traffic: "53687091200",
          ...(isPaygMode ? {} : { ai_quota: isFreePlan ? 0 : 3_000_000 }),
        },
        used: {
          "limits.cpu": "1500m",
          "limits.memory": "3Gi",
          "limits.nvidia.com/gpu": "0",
          "requests.storage": "12Gi",
          "services.nodeports": "2",
          traffic: "26843545600",
          ...(isPaygMode ? {} : { ai_quota: isFreePlan ? 0 : 1_200_000 }),
        },
      },
    };
  },
};

interface WriteFixtureResult {
  /** Scenario the successful write moves the session to. */
  nextScenario: BillingDevScenario;
  payload: unknown;
}

/**
 * Writes as scenario transitions. Each entry answers a mutation with a
 * success payload plus a `Set-Cookie` moving the scenario; returning null
 * (operator/scenario pair outside the table) answers 501 instead.
 */
const WRITE_FIXTURES: Record<
  string,
  (context: FixtureContext) => WriteFixtureResult | null
> = {
  "/account/v1alpha1/workspace-subscription/invoice-cancel": (context) => ({
    nextScenario:
      context.scenario === "pending-upgrade" ? "active" : context.scenario,
    payload: {
      invoice_id:
        typeof context.body.invoiceID === "string"
          ? context.body.invoiceID
          : MOCK_CHECKOUT_INVOICE_ID,
      message: "Mock unpaid invoice cancelled.",
      success: true,
    },
  }),
  "/account/v1alpha1/workspace-subscription/pay": (context) => {
    const operator =
      typeof context.body.operator === "string" ? context.body.operator : "";
    const nextScenario = PAY_TRANSITIONS[operator]?.[context.scenario];
    if (nextScenario == null) {
      return null;
    }
    // created/renewed/upgraded run the checkout dialog: it insists on a
    // redirect URL for the checkout window, then polls last-transaction for
    // the returned payID. about:blank skips the Stripe hop.
    const opensCheckout =
      operator === "created" ||
      operator === "renewed" ||
      operator === "upgraded";
    return {
      nextScenario,
      payload: opensCheckout
        ? {
            invoiceID: MOCK_CHECKOUT_INVOICE_ID,
            payID: MOCK_CHECKOUT_PAY_ID,
            redirectUrl: "about:blank",
            success: true,
          }
        : { success: true },
    };
  },
};

/**
 * pay-operator × current-scenario → next scenario. Upgrades land on `active`
 * (not `pending-upgrade`) because the checkout poll needs last-transaction to
 * report the payment as completed, which `pending-upgrade` by definition
 * does not; select `pending-upgrade` in the panel to eyeball the queued
 * banner directly.
 */
const PAY_TRANSITIONS: Record<
  string,
  Partial<Record<BillingDevScenario, BillingDevScenario>> | undefined
> = {
  canceled: {
    active: "cancelling",
    "active-balance": "cancelling",
    "mixed-workspaces": "cancelling",
  },
  // `deleted` is pre-wired for AIM-252: the UI still locks that lifecycle,
  // but the backend treats DELETED as subscribable-again PAYG.
  created: { deleted: "active", payg: "active", "payg-debt": "active" },
  renewed: {
    "payment-due": "active",
    "payment-due-deletion": "active",
    "payment-due-final": "active",
  },
  resumed: { cancelling: "active" },
  upgraded: {
    active: "active",
    "active-balance": "active",
    free: "active",
    "mixed-workspaces": "active",
    paused: "active",
  },
};

function mockCookieValue(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (pair.slice(0, separator).trim() === BILLING_DEV_MOCK_COOKIE) {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function transitionHeaders(
  nextScenario: BillingDevScenario
): Record<string, string> {
  const value = formatBillingDevMockCookie({
    enabled: true,
    scenario: nextScenario,
  });
  return {
    "set-cookie": `${BILLING_DEV_MOCK_COOKIE}=${value}; Path=/; SameSite=Lax`,
  };
}

export async function billingDevMockResponse(
  pathname: string,
  request: Request
): Promise<Response | null> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return null;
  }
  const parsed = parseBillingDevMockCookie(mockCookieValue(request));
  if (
    parsed.kind === "unset" ||
    (parsed.kind === "set" && !parsed.state.enabled)
  ) {
    return null;
  }
  if (parsed.kind === "invalid") {
    return Response.json(
      {
        error: `Unknown billing mock scenario "${parsed.raw}". Valid scenarios: ${BILLING_DEV_SCENARIOS.join(", ")}. Toggle the mock from the dev tweaks pane (⌃⌥T).`,
      },
      { status: 500 }
    );
  }
  const scenario = parsed.state.scenario;

  const payload: unknown = await request.json().catch(() => null);
  const body =
    typeof payload === "object" && payload != null
      ? (payload as Record<string, unknown>)
      : {};
  const requestedWorkspace =
    typeof body.workspace === "string" && body.workspace.trim() !== ""
      ? body.workspace
      : defaultWorkspace();
  const context: FixtureContext = {
    body,
    scenario,
    workspace: requestedWorkspace,
  };

  const write = WRITE_FIXTURES[pathname];
  if (write != null) {
    const result = write(context);
    if (result != null) {
      return Response.json(result.payload, {
        headers:
          result.nextScenario === scenario
            ? undefined
            : transitionHeaders(result.nextScenario),
      });
    }
  }

  const fixture = FIXTURES[pathname];
  if (fixture == null) {
    return Response.json(
      {
        error: `Billing mock mode does not support this operation (${pathname} has no fixture or transition).`,
      },
      { status: 501 }
    );
  }
  const fixtureResponse = fixture(context);
  return fixtureResponse instanceof Response
    ? fixtureResponse
    : Response.json(fixtureResponse);
}
