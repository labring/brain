import { namespaceFromKubeconfigText } from "@/lib/kubeconfig-namespace-core";

/**
 * Temporary style-testing scaffolding — delete this directory together with
 * the `billingDevMockResponse` call in `../authorized-proxy.ts`.
 *
 * When `BILLING_DEV_MOCK=<scenario>` is set (dev builds only), every
 * `/api/billing/*` proxy answers from these fixtures instead of the account
 * service, so the real /billing pages can be eyeballed in any subscription
 * state. Endpoints without a fixture (all writes) answer 501 so a mock
 * session can never mutate a real account.
 */

const BILLING_DEV_SCENARIOS = [
  "payg",
  "active",
  "active-balance",
  "cancelling",
  "payment-due",
  "pending-upgrade",
  "mixed-workspaces",
] as const;

type BillingDevScenario = (typeof BILLING_DEV_SCENARIOS)[number];

interface FixtureContext {
  body: Record<string, unknown>;
  scenario: BillingDevScenario;
  workspace: string;
}

const REGION_DOMAIN = "mock.sealos.run";
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const MOCK_WORKSPACES = {
  cancelling: "ns-mock-cancel",
  debt: "ns-mock-debt",
  payg: "ns-mock-payg",
  pro: "ns-mock-pro",
} as const;

function isBillingDevScenario(value: string): value is BillingDevScenario {
  return (BILLING_DEV_SCENARIOS as readonly string[]).includes(value);
}

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

function subscriptionPayload(
  scenario: BillingDevScenario,
  workspace: string
): Record<string, unknown> {
  if (scenario === "payg") {
    // The upstream embeds a nil subscription and serializes only the type.
    return { type: "PAYG" };
  }
  const base = {
    CancelAtPeriodEnd: false,
    CurrentPeriodEndAt: daysFromNow(12),
    ExpireAt: null,
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
    case "payment-due":
      return {
        ...base,
        InvoiceInfo: {
          ID: "inv-mock-1",
          PaymentUrl: "https://billing.example.com/invoice/inv-mock-1",
        },
        Status: "debt",
      };
    default:
      return base;
  }
}

function subscriptionListPayload(context: FixtureContext): unknown[] {
  if (context.scenario === "payg") {
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
  return {
    app_costs: {
      costs: rows,
      current_page: 1,
      total_pages: 1,
      total_records: rows.length,
    },
  };
}

const FIXTURES: Record<string, (context: FixtureContext) => unknown> = {
  "/account/v1alpha1/account": ({ scenario }) => ({
    account:
      scenario === "payment-due"
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
    return { data: { overviews, total: overviews.length, totalPage: 1 } };
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
    payment_method:
      scenario === "payg" || scenario === "active-balance"
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
  }) =>
    scenario === "pending-upgrade"
      ? {
          transaction: {
            ID: "txn-mock-1",
            NewPlanName: "Pro",
            Operator: "upgraded",
            PayID: "pay-mock-upgrade",
            StartAt: daysFromNow(12),
            Status: "pending",
          },
        }
      : {},
  "/account/v1alpha1/workspace-subscription/list": (context) => ({
    subscriptions: subscriptionListPayload(context),
  }),
  "/account/v1alpha1/workspace-subscription/payment-list": (context) => ({
    payments: paymentsPayload(context),
  }),
  "/account/v1alpha1/workspace-subscription/plan-list": () => ({
    plans: PLAN_CATALOG,
  }),
  "/account/v1alpha1/workspace-subscription/upgrade-amount": () => ({
    amount: 103_000_000,
    has_discount: false,
    original_amount: 103_000_000,
    promotion_code: "",
  }),
  // Mirrors the production Hobby plan's MaxResources (the scenarios' current
  // plan) so downgrade checks compare realistic numbers.
  "/account/v1alpha1/workspace/get-resource-quota": () => ({
    quota: {
      hard: {
        "limits.cpu": "4",
        "limits.memory": "4Gi",
        "limits.nvidia.com/gpu": "0",
        "requests.storage": "20Gi",
        "services.nodeports": "8",
        traffic: "53687091200",
      },
      used: {
        "limits.cpu": "1500m",
        "limits.memory": "3Gi",
        "limits.nvidia.com/gpu": "0",
        "requests.storage": "12Gi",
        "services.nodeports": "2",
        traffic: "26843545600",
      },
    },
  }),
};

export async function billingDevMockResponse(
  pathname: string,
  request: Request
): Promise<Response | null> {
  // eslint-disable-next-line turbo/no-undeclared-env-vars -- temporary dev-only knob, never a build input
  const scenario = process.env.BILLING_DEV_MOCK?.trim() ?? "";
  if (process.env.NODE_ENV === "production" || scenario === "") {
    return null;
  }
  if (!isBillingDevScenario(scenario)) {
    return Response.json(
      {
        error: `Unknown BILLING_DEV_MOCK scenario "${scenario}". Valid scenarios: ${BILLING_DEV_SCENARIOS.join(", ")}.`,
      },
      { status: 500 }
    );
  }

  const fixture = FIXTURES[pathname];
  if (fixture == null) {
    return Response.json(
      {
        error: `BILLING_DEV_MOCK is on; ${pathname} has no fixture (writes are disabled in mock mode).`,
      },
      { status: 501 }
    );
  }

  const payload: unknown = await request.json().catch(() => null);
  const body =
    typeof payload === "object" && payload != null
      ? (payload as Record<string, unknown>)
      : {};
  const requestedWorkspace =
    typeof body.workspace === "string" && body.workspace.trim() !== ""
      ? body.workspace
      : defaultWorkspace();
  return Response.json(
    fixture({ body, scenario, workspace: requestedWorkspace })
  );
}
