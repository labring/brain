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

const PLAN_CATALOG = [
  {
    AIQuota: 0,
    Description: "Get started with personal experiments.",
    DowngradePlanList: [],
    ID: "plan-free",
    MaxResources: { cpu: "1", memory: "1Gi", nodeports: 1, storage: "10Gi" },
    MaxSeats: 1,
    Name: "Free",
    Order: 0,
    Prices: [{ BillingCycle: "1m", OriginalPrice: 0, Price: 0 }],
    Tags: [],
    Traffic: 10_240,
    UpgradePlanList: ["Hobby", "Pro"],
  },
  {
    AIQuota: 100,
    Description: "Everything a side project needs.",
    DowngradePlanList: ["Free"],
    ID: "plan-hobby",
    MaxResources: { cpu: "4", memory: "8Gi", nodeports: 5, storage: "100Gi" },
    MaxSeats: 3,
    Name: "Hobby",
    Order: 1,
    Prices: [
      { BillingCycle: "1m", OriginalPrice: 7_000_000, Price: 5_000_000 },
    ],
    Tags: [],
    Traffic: 102_400,
    UpgradePlanList: ["Pro"],
  },
  {
    AIQuota: 1000,
    Description: "Production workloads with room to grow.",
    DowngradePlanList: ["Free", "Hobby"],
    ID: "plan-pro",
    MaxResources: {
      cpu: "16",
      memory: "32Gi",
      nodeports: 20,
      storage: "500Gi",
    },
    MaxSeats: 10,
    Name: "Pro",
    Order: 2,
    Prices: [
      { BillingCycle: "1m", OriginalPrice: 20_000_000, Price: 20_000_000 },
    ],
    Tags: [],
    Traffic: 1_048_576,
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
    Amount: 5_000_000,
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
    { amount: 6_820_000, appName: "brain-api", appType: 1 },
    { amount: 4_310_000, appName: "postgres-main", appType: 2 },
    {
      amount: 2_150_000,
      appName: "an-unreasonably-long-application-name-that-tests-truncation",
      appType: 1,
    },
    { amount: 1_930_000, appName: "devbox-experiments", appType: 3 },
    { amount: 1_120_000, appName: "asset-bucket", appType: 4 },
    { amount: 640_000, appName: "nightly-report", appType: 5 },
    { amount: 410_000, appName: "ai-proxy-gateway", appType: 8 },
    { amount: 90_000, appName: "redis-cache", appType: 2 },
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
    app_type: 1,
    namespace: context.workspace,
    order_id: `ord-mock-${index + 1}`,
    resources_by_type: [
      {
        amount: 380_000 + index * 45_000,
        app_name: "brain-api",
        app_type: 1,
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
  "/account/v1alpha1/cost-app-type-list": () => ({
    data: {
      1: "App Launchpad",
      2: "Database",
      3: "DevBox",
      4: "Object Storage",
      5: "Cron Job",
      8: "AI Proxy",
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
    amount: 15_000_000,
    has_discount: false,
    original_amount: 15_000_000,
    promotion_code: "",
  }),
  "/account/v1alpha1/workspace/get-resource-quota": () => ({
    quota: {
      hard: {
        "limits.cpu": "4",
        "limits.memory": "8Gi",
        "limits.nvidia.com/gpu": "1",
        "requests.storage": "100Gi",
        "services.nodeports": "5",
        traffic: "107374182400",
      },
      used: {
        "limits.cpu": "1500m",
        "limits.memory": "3Gi",
        "limits.nvidia.com/gpu": "0",
        "requests.storage": "40Gi",
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
