import assert from "node:assert/strict";
import { test } from "node:test";

import { installTestDom } from "@/features/project-canvas/react-test-harness";

// The assertions below compare against calendar-day strings ("Aug 31, 2026")
// that the surfaces render in the process's local timezone. Pin the timezone
// before the surface modules are (dynamically) imported and construct their
// formatters, so the expected day matches on machines in any timezone.
process.env.TZ = "UTC";

import type { BillingPlanSnapshot } from "./billing-plan-data";
import type { BillingPricingSnapshot } from "./billing-pricing-data";
import type { BillingUsageSnapshot } from "./billing-usage-data";

// Loaded with a DOM registered, matching the interaction tests' convention:
// importing a component graph (next/link etc.) without a DOM poisons React
// rendering for interaction test files that run later in the same process.
async function loadSurfaceModules() {
  const dom = installTestDom();
  try {
    const [
      { renderToStaticMarkup },
      { BillingCostCharts },
      { BillingCostsSurface },
      { formatBillingDateTime },
      { BillingPlanPicker },
      { BillingPlanSurface },
      { BillingPlanCatalogSection, BillingPriceTable, BillingPricingSurface },
      { BillingNavigationFrame },
      { BillingUsageSurface },
    ] = await Promise.all([
      import("react-dom/server"),
      import("./billing-cost-charts"),
      import("./billing-costs"),
      import("./billing-datetime"),
      import("./billing-plan-picker"),
      import("./billing-plan-surface"),
      import("./billing-pricing"),
      import("./billing-tab-shell"),
      import("./billing-usage"),
    ]);
    return {
      BillingCostCharts,
      BillingCostsSurface,
      BillingNavigationFrame,
      BillingPlanCatalogSection,
      BillingPlanPicker,
      BillingPlanSurface,
      BillingPriceTable,
      BillingPricingSurface,
      BillingUsageSurface,
      formatBillingDateTime,
      renderToStaticMarkup,
    };
  } finally {
    await dom.restore();
  }
}

let cachedModules: ReturnType<typeof loadSurfaceModules> | undefined;

function surfaceModules() {
  cachedModules ??= loadSurfaceModules();
  return cachedModules;
}

function assertTextOrder(html: string, labels: readonly string[]) {
  let previousIndex = -1;
  for (const label of labels) {
    const index = html.indexOf(label);
    assert.ok(index > previousIndex, `${label} follows the preceding section`);
    previousIndex = index;
  }
}

function assertIncludes(html: string, fragment: string) {
  assert.ok(html.includes(fragment), `${fragment} is rendered`);
}

const USAGE_BUTTON_RE =
  /<button(?=[^>]*data-size="default")(?=[^>]*data-slot="app-button")(?=[^>]*data-variant="secondary")[^>]*>Usage<\/button>/;

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const USAGE_SNAPSHOT = {
  rows: [
    {
      label: "CPU",
      percentUsed: 37.5,
      remaining: "2.5",
      total: "4",
      type: "cpu",
      used: "1.5",
    },
    {
      label: "Memory",
      percentUsed: 37.5,
      remaining: "5Gi",
      total: "8Gi",
      type: "memory",
      used: "3Gi",
    },
    {
      label: "Storage",
      percentUsed: 40,
      remaining: "60Gi",
      total: "100Gi",
      type: "storage",
      used: "40Gi",
    },
    {
      label: "Ports",
      percentUsed: 30,
      remaining: "7",
      total: "10",
      type: "nodeport",
      used: "3",
    },
    {
      label: "Traffic",
      percentUsed: 25,
      remaining: "75Gi",
      total: "100Gi",
      type: "traffic",
      used: "25Gi",
    },
    {
      label: "GPU",
      percentUsed: 50,
      remaining: "1",
      total: "2",
      type: "gpu",
      used: "1",
    },
  ],
  selectedWorkspace: "workspace-a",
  workspaces: [{ id: "workspace-a", name: "Workspace Alpha" }],
} satisfies BillingUsageSnapshot;

const PRICING_SNAPSHOT = {
  isPayg: true,
  plans: [
    {
      description: "For personal projects",
      hasMonthlyPrice: true,
      id: "plan-starter",
      monthlyOriginalPriceMicroUnits: 0,
      monthlyPriceMicroUnits: 5_000_000,
      name: "Starter",
      order: 1,
      primaryPriceMicroUnits: 5_000_000,
      resources: [
        { label: "CPU", type: "cpu", value: "2" },
        { label: "Memory", type: "memory", value: "4Gi" },
        { label: "GPU", type: "gpu", value: "1" },
      ],
      tags: [],
    },
  ],
  prices: [
    {
      hourlyPriceMicroUnits: 10_000,
      label: "CPU",
      billingBasis: "duration",
      sourceName: "cpu",
      type: "cpu",
      unit: "vCPU",
    },
    {
      hourlyPriceMicroUnits: 20_480,
      label: "Memory",
      billingBasis: "duration",
      sourceName: "memory",
      type: "memory",
      unit: "GiB",
    },
    {
      hourlyPriceMicroUnits: 750_000,
      label: "NVIDIA A100",
      billingBasis: "duration",
      sourceName: "gpu-a100",
      type: "gpu",
      unit: "GPU",
    },
  ],
} satisfies BillingPricingSnapshot;

const CANCELLING_PLAN = {
  availability: {
    card: "available",
    transaction: "available",
    workspaces: "available",
  },
  card: { brand: "visa", expMonth: 12, expYear: 2028, last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: true,
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    expireAt: "2026-08-31T00:00:00Z",
    invoiceId: "invoice-1",
    invoicePaymentUrl: "https://payments.example.test/invoice-1",
    isPayg: false,
    lifecycle: "cancelling",
    payMethod: "stripe",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    regionDomain: "us.example.test",
    resources: [
      { label: "CPU", value: "4" },
      { label: "Memory", value: "8Gi" },
    ],
    // Cancelling: the deadline is the suspension date (the period end).
    warningDeadlineAt: "2026-08-31T00:00:00Z",
    warningStage: "cancelling",
    workspace: "workspace-a",
  },
  pendingDowngrade: null,
  pendingUpgrade: {
    planName: "Team",
    startsAt: "2026-08-31T00:00:00Z",
  },
  plans: [
    {
      description: "For personal projects",
      id: "plan-starter",
      isCurrent: false,
      name: "Starter",
      order: 1,
      priceMicroUnits: 5_000_000,
      resources: [{ label: "CPU", value: "1" }],
    },
    {
      description: "For growing workloads",
      id: "plan-pro",
      isCurrent: true,
      name: "Pro",
      order: 2,
      priceMicroUnits: 20_000_000,
      resources: [{ label: "CPU", value: "4" }],
    },
    {
      description: "For larger teams",
      id: "plan-team",
      isCurrent: false,
      name: "Team",
      order: 3,
      priceMicroUnits: 50_000_000,
      resources: [{ label: "CPU", value: "12" }],
    },
  ],
  workspaces: [
    {
      id: "workspace-a",
      isCurrent: true,
      lifecycle: "cancelling",
      name: "Workspace Alpha",
      planName: "Pro",
      priceMicroUnits: 20_000_000,
      renewalAt: "2026-08-31T00:00:00Z",
    },
    {
      id: "workspace-b",
      isCurrent: false,
      lifecycle: "active",
      name: "Workspace Beta",
      planName: "Starter",
      priceMicroUnits: 5_000_000,
      renewalAt: "2026-08-15T00:00:00Z",
    },
  ],
} satisfies BillingPlanSnapshot;

test("Billing Area keeps Cost Center's vertical navigation hierarchy", async () => {
  const { BillingNavigationFrame, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingNavigationFrame activeTab="usage">
      <div>Current page</div>
    </BillingNavigationFrame>
  );

  assertIncludes(html, 'aria-label="Billing sections"');
  assertIncludes(html, 'data-slot="billing-section-navigation"');
  assertTextOrder(html, ["Plan", "Costs", "Usage", "Pricing"]);
  const activeLinkStart = html.indexOf('<a aria-current="page"');
  const activeLinkEnd = html.indexOf("</a>", activeLinkStart);
  const activeLink = html.slice(activeLinkStart, activeLinkEnd);
  assertIncludes(activeLink, 'href="/billing/usage"');
  assertIncludes(activeLink, "bg-input");
  assertIncludes(activeLink, "text-blue-400");
  assert.equal(activeLink.includes("hover:bg-input/30"), false);
  assertTextOrder(html, ["Billing", "Current page"]);
});

test("Plan keeps Cost Center's section order around the live balance", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      credits={<section>AI Credits</section>}
      currency="usd"
      snapshot={CANCELLING_PLAN}
    />
  );

  assertTextOrder(html, [
    "Current Workspace Plan",
    "AI Credits",
    "Account Balance",
    "Payment method",
    "All Plans",
  ]);
  assertIncludes(html, "$3.00");
  assertIncludes(html, 'data-slot="billing-plan-summary"');
  assertIncludes(html, 'data-slot="billing-balance-section"');
  assertIncludes(html, 'data-slot="billing-payment-method-section"');
  assertIncludes(html, 'data-slot="billing-all-workspaces-section"');
  assert.equal(html.includes("Compare plans"), false);
});

test("Plan renders lifecycle notices, card facts, and workspace plan rows", async () => {
  const { BillingPlanSurface, formatBillingDateTime, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={CANCELLING_PLAN}
    />
  );

  for (const text of [
    "Pending upgrade to Team",
    "Your subscription is cancelled",
    "Your workspace will be suspended after",
    "Aug 31, 2026",
    "Visa",
    "•••• 4242",
    "EXP: 12/28",
    "us.example.test",
    "Workspace Alpha",
    "Workspace Beta",
    "Starter",
    formatBillingDateTime("2026-08-15T00:00:00Z"),
    "$20.00",
    "$5.00",
    "$3.00",
  ]) {
    assertIncludes(html, text);
  }
  // The warning banner suppresses the lifecycle badge and the standalone
  // unpaid-invoice alert; it carries no payment link of its own.
  assert.equal(html.includes("You have an unpaid invoice"), false);
  assert.equal(html.includes("https://payments.example.test"), false);
  // A pending upgrade is voiced only by the target-naming change badge; the
  // bare lifecycle badge and the "Plan Cancelled" wording are retired.
  assert.equal(html.includes(">Pending upgrade<"), false);
  assert.equal(html.includes("Plan Cancelled"), false);
});

test("Plan renders local fallbacks when auxiliary billing data is unavailable", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    availability: {
      card: "unavailable",
      transaction: "unavailable",
      workspaces: "unavailable",
    },
    card: null,
    pendingDowngrade: null,
    pendingUpgrade: null,
    workspaces: [],
  };
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={snapshot}
    />
  );

  assertIncludes(html, "Pro Plan");
  assertIncludes(html, "Recent plan changes unavailable");
  assertIncludes(html, "Payment method unavailable");
  assertIncludes(html, "Workspace plans unavailable");
});

test("Plan disables changes for deleted and unavailable subscription states", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  for (const [lifecycle, notice] of [
    ["deleted", "Subscription ended"],
    ["unavailable", "Subscription status unavailable"],
  ] as const) {
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        lifecycle,
        warningDeadlineAt: null,
        warningStage: null,
      },
      pendingUpgrade: null,
    };
    const html = renderToStaticMarkup(
      <BillingPlanSurface
        balance={<span>$3.00</span>}
        currency="usd"
        snapshot={snapshot}
      />
    );

    assertIncludes(html, notice);
    assert.equal(html.includes("Cancel Plan"), false);
    assert.equal(html.includes("Upgrade Plan"), false);
    assert.equal(html.includes(">Renew<"), false);
    assert.equal(html.includes("Pay invoice"), false);
    assert.equal(html.includes("Cancel invoice"), false);
    assert.equal(html.includes("Manage Card Info"), false);
  }
});

test("Pricing disables plan selection for closed subscription states", async () => {
  const { BillingPlanCatalogSection, renderToStaticMarkup } =
    await surfaceModules();
  for (const lifecycle of ["deleted", "unavailable"] as const) {
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        lifecycle,
      },
      plans: CANCELLING_PLAN.plans.map((plan) => ({
        ...plan,
        changeKind: plan.isCurrent ? null : ("upgrade" as const),
      })),
    };
    const html = renderToStaticMarkup(
      <BillingPlanCatalogSection
        currency="usd"
        gpuEnabled
        planSnapshot={snapshot}
      />
    );

    assertIncludes(html, "Team");
    assert.equal(html.includes(">Upgrade<"), false);
  }
});

test("Pricing exposes only the pending upgrade recovery target", async () => {
  const { BillingPlanCatalogSection, renderToStaticMarkup } =
    await surfaceModules();
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    current: {
      ...CANCELLING_PLAN.current,
      lifecycle: "pending-upgrade",
    },
  };
  const html = renderToStaticMarkup(
    <BillingPlanCatalogSection
      currency="usd"
      gpuEnabled
      planSnapshot={snapshot}
    />
  );

  assertIncludes(html, "Recover payment");
  assertIncludes(html, "Payment in progress");
  assert.equal(html.includes(">Upgrade<"), false);
  assert.equal(html.includes(">Downgrade<"), false);
});

test("Plan renders the compact PAYG summary next to the balance", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    card: null,
    current: {
      ...CANCELLING_PLAN.current,
      cancelAtPeriodEnd: false,
      currentPeriodEndAt: "",
      invoiceId: null,
      invoicePaymentUrl: null,
      isPayg: true,
      lifecycle: "active",
      planName: "PAYG",
      priceMicroUnits: 0,
      warningDeadlineAt: null,
      warningStage: null,
    },
    pendingDowngrade: null,
    pendingUpgrade: null,
  };
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={snapshot}
    />
  );

  assertTextOrder(html, [
    "Current Workspace Plan",
    "Pay-As-You-Go",
    "Account Balance",
  ]);
  assertIncludes(html, "Subscribe Plan");
  for (const absent of [
    "Cancel Plan",
    "Upgrade Plan",
    "Price/Month",
    "No included resource quota",
    "Payment method",
  ]) {
    assert.equal(html.includes(absent), false, `${absent} is not rendered`);
  }
});

test("Plan shows the free-plan expiry warning when expiry is within seven days", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    current: {
      ...CANCELLING_PLAN.current,
      cancelAtPeriodEnd: false,
      currentPeriodEndAt: new Date(
        Date.now() + 6 * DAY_IN_MILLISECONDS
      ).toISOString(),
      invoiceId: null,
      invoicePaymentUrl: null,
      lifecycle: "active",
      planName: "Free",
      priceMicroUnits: 0,
      warningDeadlineAt: null,
      warningStage: null,
    },
    pendingDowngrade: null,
    pendingUpgrade: null,
  };
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={snapshot}
    />
  );

  assertIncludes(html, "The Free plan expires on");
  assert.equal(html.includes("being cancelled"), false);
  assert.equal(html.includes("unpaid invoice"), false);
});

test("Plan hides the free-plan expiry warning outside the near-expiry window", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  for (const daysUntilExpiry of [8, -1]) {
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        currentPeriodEndAt: new Date(
          Date.now() + daysUntilExpiry * DAY_IN_MILLISECONDS
        ).toISOString(),
        invoiceId: null,
        invoicePaymentUrl: null,
        lifecycle: "active",
        planName: "Free",
        priceMicroUnits: 0,
        warningDeadlineAt: null,
        warningStage: null,
      },
      pendingDowngrade: null,
      pendingUpgrade: null,
    };
    const html = renderToStaticMarkup(
      <BillingPlanSurface
        balance={<span>$3.00</span>}
        currency="usd"
        snapshot={snapshot}
      />
    );

    assert.equal(html.includes("The Free plan expires on"), false);
  }
});

test("Plan keeps cancellation available while an upgrade is pending", async () => {
  const { BillingPlanSurface, renderToStaticMarkup } = await surfaceModules();
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    current: {
      ...CANCELLING_PLAN.current,
      cancelAtPeriodEnd: false,
      invoiceId: null,
      invoicePaymentUrl: null,
      lifecycle: "pending-upgrade",
      warningDeadlineAt: null,
      warningStage: null,
    },
  };
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={snapshot}
    />
  );

  assertIncludes(html, "Cancel Plan");
});

test("Costs preserves Cost Center's detail and trend information layers", async () => {
  const { BillingCostCharts, BillingCostsSurface, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(<BillingCostsSurface />);

  assertTextOrder(html, ["Billing", "Cost &amp; Top-up Trends"]);
  assertTextOrder(html, [
    "Select a card to view cost details",
    'data-slot="billing-cost-scope-banner"',
    "Hangzhou / sealos-test Cost",
    "Subscription",
    "PAYG",
  ]);
  for (const label of [
    'data-slot="billing-cost-scope-card"',
    "Total Cost",
    "Time",
    "Plan",
    "Item",
    "Type",
    "Action",
    "Total:",
    "/ Page",
    'data-slot="plan-badge"',
    'data-slot="app-type-badge"',
    "Starter",
    "Pro",
    "Enterprise",
  ]) {
    assertIncludes(html, label);
  }
  assert.match(html, USAGE_BUTTON_RE);

  const chartsHtml = renderToStaticMarkup(<BillingCostCharts currency="usd" />);
  assertTextOrder(chartsHtml, [
    "Cost Trends",
    "Last 7 days",
    "Monthly Top-ups and Charges",
    "Last 6 Months",
    "All Regions",
  ]);
});

test("Usage preserves the quota table's workspace and resource hierarchy", async () => {
  const { BillingUsageSurface, renderToStaticMarkup } = await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingUsageSurface gpuEnabled={false} snapshot={USAGE_SNAPSHOT} />
  );

  assertTextOrder(html, [
    "Resource Name",
    "Chart",
    "Total",
    "Used",
    "Available",
  ]);
  for (const text of [
    "Workspace Alpha",
    "CPU",
    "Memory",
    "Storage",
    "Ports",
    "Traffic",
    "2.5",
    "5Gi",
    "60Gi",
    "7",
    "75Gi",
  ]) {
    assertIncludes(html, text);
  }
  assert.equal(html.includes(">GPU<"), false);
  assert.equal(html.includes(">37.5%<"), false);
  assert.equal(html.includes("Current quota allocation"), false);
});

test("Usage adds the GPU quota row only when the cluster flag is enabled", async () => {
  const { BillingUsageSurface, renderToStaticMarkup } = await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingUsageSurface gpuEnabled snapshot={USAGE_SNAPSHOT} />
  );

  assertIncludes(html, ">GPU<");
  assertTextOrder(html, [
    "CPU",
    "Memory",
    "Storage",
    "Ports",
    "Traffic",
    "GPU",
  ]);
});

test("Pricing preserves Cost Center's three pricing information layers", async () => {
  const { BillingPricingSurface, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingPricingSurface
      currency="usd"
      gpuEnabled={false}
      planSnapshot={CANCELLING_PLAN}
      snapshot={PRICING_SNAPSHOT}
    />
  );

  assertTextOrder(html, [
    "Subscription plans",
    "Price table",
    "Price calculator",
  ]);
  assertIncludes(html, "Choose Your Workspace Plan");
  assertIncludes(html, 'data-slot="billing-plan-picker"');
  assertIncludes(html, 'aria-label="Pricing views"');
});

test("Pricing hides the view switcher when only subscription plans are available", async () => {
  const { BillingPricingSurface, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingPricingSurface
      currency="usd"
      gpuEnabled
      planSnapshot={CANCELLING_PLAN}
      snapshot={{ ...PRICING_SNAPSHOT, isPayg: false }}
    />
  );

  assertIncludes(html, "Choose Your Workspace Plan");
  assertIncludes(html, 'data-slot="billing-plan-picker"');
  assert.equal(html.includes('aria-label="Pricing views"'), false);
  assert.equal(html.includes("Subscription plans"), false);
  assert.equal(html.includes("Price table"), false);
  assert.equal(html.includes("Price calculator"), false);
});

test("Pricing surfaces a plans-area error state when the plan snapshot fails", async () => {
  const { BillingPricingSurface, renderToStaticMarkup } =
    await surfaceModules();
  const html = renderToStaticMarkup(
    <BillingPricingSurface
      currency="usd"
      gpuEnabled={false}
      planSnapshotError={new Error("account-service is down")}
      snapshot={PRICING_SNAPSHOT}
    />
  );

  assertIncludes(html, "Choose Your Workspace Plan");
  assertIncludes(html, "Subscription plans are unavailable.");
  assertIncludes(html, "account-service is down");
  assert.equal(html.includes('data-slot="billing-plan-picker"'), false);
});

const PICKER_PLANS: BillingPlanSnapshot["plans"] = [
  {
    changeKind: "upgrade",
    description: "For personal projects",
    id: "plan-starter",
    isCurrent: false,
    name: "Starter",
    order: 1,
    priceMicroUnits: 5_000_000,
    resources: [
      { label: "CPU", type: "cpu", value: "2" },
      { label: "Memory", type: "memory", value: "4Gi" },
      { label: "GPU", type: "gpu", value: "1" },
    ],
  },
];

test("Pricing renders cluster currency and filters GPU picker and price rows", async () => {
  const { BillingPlanPicker, BillingPriceTable, renderToStaticMarkup } =
    await surfaceModules();
  const withoutGpu = renderToStaticMarkup(
    <>
      <BillingPlanPicker
        actionable
        currency="cny"
        gpuEnabled={false}
        inDebt={false}
        onOpenUrl={() => undefined}
        pendingDowngradePlanName={null}
        plans={PICKER_PLANS}
      />
      <BillingPriceTable
        currency="cny"
        cycleIndex={0}
        gpuEnabled={false}
        prices={PRICING_SNAPSHOT.prices}
      />
    </>
  );

  assertIncludes(withoutGpu, "Starter");
  assertIncludes(withoutGpu, "¥5.00");
  assertIncludes(withoutGpu, "Price (¥)");
  assertIncludes(withoutGpu, "0.010000");
  assert.equal(withoutGpu.includes("NVIDIA A100"), false);
  assert.equal(withoutGpu.includes("1 GPU"), false);
  assert.equal(withoutGpu.includes("GPU Price Table"), false);

  const withGpu = renderToStaticMarkup(
    <>
      <BillingPlanPicker
        actionable
        currency="usd"
        gpuEnabled
        inDebt={false}
        onOpenUrl={() => undefined}
        pendingDowngradePlanName={null}
        plans={PICKER_PLANS}
      />
      <BillingPriceTable
        currency="usd"
        cycleIndex={0}
        gpuEnabled
        prices={PRICING_SNAPSHOT.prices}
      />
    </>
  );
  assertIncludes(withGpu, "1 GPU");
  assertIncludes(withGpu, "NVIDIA A100");
  assertTextOrder(withGpu, ["Basic Pricing", "GPU Price Table", "NVIDIA A100"]);
});

test("Plan Picker splits cards from the more-plans selector like the dialog", async () => {
  const { BillingPlanPicker, renderToStaticMarkup } = await surfaceModules();
  const basePlan = PICKER_PLANS[0];
  assert.ok(basePlan);
  const plans: BillingPlanSnapshot["plans"] = [
    {
      ...basePlan,
      changeKind: null,
      id: "free",
      isCurrent: true,
      name: "Free",
      order: 0,
    },
    {
      ...basePlan,
      id: "hobby",
      name: "Hobby",
      order: 1,
    },
    {
      ...basePlan,
      id: "standard",
      name: "Standard",
      order: 2,
      originalPriceMicroUnits: 8_000_000,
    },
    {
      ...basePlan,
      id: "pro",
      name: "Pro",
      order: 3,
      tags: ["more"],
    },
    {
      ...basePlan,
      id: "team",
      name: "Team",
      order: 4,
      tags: ["more"],
    },
    {
      ...basePlan,
      description: "https://contact.example.test",
      id: "customized",
      name: "Customized",
      order: 0,
      tags: ["more"],
    },
  ];
  const html = renderToStaticMarkup(
    <BillingPlanPicker
      actionable
      currency="usd"
      gpuEnabled={false}
      inDebt={false}
      onOpenUrl={() => undefined}
      pendingDowngradePlanName={null}
      plans={plans}
    />
  );

  // Free never renders as a card; Hobby and Standard do, with the Standard
  // card carrying the badge and the discounted price pair.
  assertTextOrder(html, ["Hobby", "Standard"]);
  assert.equal(html.includes(">Free<"), false);
  for (const text of [
    "Most Popular",
    "$8.00",
    "$5.00",
    "Priority Support",
    "All Hobby Features",
    "99.99% SLA",
    'aria-label="More plans"',
  ]) {
    assertIncludes(html, text);
  }
  // The selector defaults to the first purchasable "more" plan (Pro), whose
  // action stays alongside; the contact-jump entry is not the default.
  assertTextOrder(html, ["More plans", "Pro"]);
  assertIncludes(html, "Upgrade");
});
