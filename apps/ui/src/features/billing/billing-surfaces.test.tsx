import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BillingCostsSurface } from "./billing-costs";
import type { BillingPlanSnapshot } from "./billing-plan-data";
import { BillingPlanSurface } from "./billing-plan-surface";
import {
  BillingPlanCatalog,
  BillingPriceTable,
  BillingPricingSurface,
} from "./billing-pricing";
import type {
  BillingPricingPlan,
  BillingPricingSnapshot,
} from "./billing-pricing-data";
import { BillingNavigationFrame } from "./billing-tab-shell";
import { BillingUsageSurface } from "./billing-usage";
import type { BillingUsageSnapshot } from "./billing-usage-data";

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
  card: { brand: "visa", last4: "4242" },
  current: {
    canManage: true,
    cancelAtPeriodEnd: true,
    currentPeriodEndAt: "2026-08-31T00:00:00Z",
    expireAt: "2026-08-31T00:00:00Z",
    invoicePaymentUrl: "https://payments.example.test/invoice-1",
    lifecycle: "cancelling",
    payMethod: "stripe",
    planName: "Pro",
    priceMicroUnits: 20_000_000,
    regionDomain: "us.example.test",
    resources: [
      { label: "CPU", value: "4" },
      { label: "Memory", value: "8Gi" },
    ],
    workspace: "workspace-a",
  },
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
      recentSpendMicroUnits: 12_500_000,
    },
    {
      id: "workspace-b",
      isCurrent: false,
      lifecycle: "active",
      name: "Workspace Beta",
      planName: "Starter",
      recentSpendMicroUnits: 3_000_000,
    },
  ],
} satisfies BillingPlanSnapshot;

test("Billing Area keeps Cost Center's vertical navigation hierarchy", () => {
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
  assertIncludes(
    html.slice(activeLinkStart, activeLinkEnd),
    'href="/billing/usage"'
  );
  assertTextOrder(html, ["Billing", "Current page"]);
});

test("Plan keeps Cost Center's section order around the live balance", () => {
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={CANCELLING_PLAN}
    />
  );

  assertTextOrder(html, [
    "Current workspace plan",
    "Account Balance",
    "Payment method",
    "Compare plans",
    "All workspaces",
  ]);
  assertIncludes(html, "$3.00");
  assertIncludes(html, 'data-slot="billing-plan-summary"');
  assertIncludes(html, 'data-slot="billing-balance-section"');
  assertIncludes(html, 'data-slot="billing-payment-method-section"');
  assertIncludes(html, 'data-slot="billing-all-plans-section"');
});

test("Plan renders lifecycle notices, card facts, the catalog, and workspace spend", () => {
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={CANCELLING_PLAN}
    />
  );

  for (const text of [
    "Cancelling",
    "Pending upgrade to Team",
    "Your subscription is being cancelled",
    "You have an unpaid invoice",
    "Visa ending in 4242",
    "Starter",
    "Pro",
    "Team",
    "Workspace Alpha",
    "Workspace Beta",
    "$12.50",
    "$3.00",
  ]) {
    assertIncludes(html, text);
  }
  assertIncludes(html, 'href="https://payments.example.test/invoice-1"');
  assertIncludes(html, 'data-slot="subscription-plan-comparison"');
});

test("Plan shows the free-plan expiry warning when expiry is within seven days", () => {
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    current: {
      ...CANCELLING_PLAN.current,
      cancelAtPeriodEnd: false,
      currentPeriodEndAt: new Date(
        Date.now() + 6 * DAY_IN_MILLISECONDS
      ).toISOString(),
      invoicePaymentUrl: null,
      lifecycle: "active",
      planName: "Free",
      priceMicroUnits: 0,
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

  assertIncludes(html, "The Free plan expires on");
  assert.equal(html.includes("being cancelled"), false);
  assert.equal(html.includes("unpaid invoice"), false);
});

test("Plan hides the free-plan expiry warning outside the near-expiry window", () => {
  for (const daysUntilExpiry of [8, -1]) {
    const snapshot: BillingPlanSnapshot = {
      ...CANCELLING_PLAN,
      current: {
        ...CANCELLING_PLAN.current,
        cancelAtPeriodEnd: false,
        currentPeriodEndAt: new Date(
          Date.now() + daysUntilExpiry * DAY_IN_MILLISECONDS
        ).toISOString(),
        invoicePaymentUrl: null,
        lifecycle: "active",
        planName: "Free",
        priceMicroUnits: 0,
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

    assert.equal(html.includes("The Free plan expires on"), false);
  }
});

test("Plan keeps cancellation available while an upgrade is pending", () => {
  const snapshot: BillingPlanSnapshot = {
    ...CANCELLING_PLAN,
    current: {
      ...CANCELLING_PLAN.current,
      cancelAtPeriodEnd: false,
      invoicePaymentUrl: null,
      lifecycle: "pending-upgrade",
    },
  };
  const html = renderToStaticMarkup(
    <BillingPlanSurface
      balance={<span>$3.00</span>}
      currency="usd"
      snapshot={snapshot}
    />
  );

  assertIncludes(html, "Cancel subscription");
});

test("Costs preserves Cost Center's detail and trend information layers", () => {
  const html = renderToStaticMarkup(<BillingCostsSurface />);

  assertTextOrder(html, ["Cost details", "Cost and payment trends"]);
  for (const label of [
    "Date range",
    "Cost scope",
    "Subscription costs",
    "Metered consumption",
  ]) {
    assertIncludes(html, label);
  }
});

test("Usage preserves the quota table's workspace and resource hierarchy", () => {
  const html = renderToStaticMarkup(
    <BillingUsageSurface gpuEnabled={false} snapshot={USAGE_SNAPSHOT} />
  );

  assertTextOrder(html, [
    "Workspace usage",
    "Resource",
    "Usage",
    "Total",
    "Used",
    "Remaining",
  ]);
  for (const text of [
    "Workspace Alpha",
    "CPU",
    "Memory",
    "Storage",
    "Traffic",
    "2.5",
    "5Gi",
    "60Gi",
    "75Gi",
  ]) {
    assertIncludes(html, text);
  }
  assert.equal(html.includes(">GPU<"), false);
});

test("Usage adds the GPU quota row only when the cluster flag is enabled", () => {
  const html = renderToStaticMarkup(
    <BillingUsageSurface gpuEnabled snapshot={USAGE_SNAPSHOT} />
  );

  assertIncludes(html, ">GPU<");
  assertTextOrder(html, ["CPU", "Memory", "Storage", "Traffic", "GPU"]);
});

test("Pricing preserves Cost Center's three pricing information layers", () => {
  const html = renderToStaticMarkup(
    <BillingPricingSurface
      currency="usd"
      gpuEnabled={false}
      snapshot={PRICING_SNAPSHOT}
    />
  );

  assertTextOrder(html, [
    "Subscription plans",
    "Price table",
    "Price calculator",
  ]);
});

test("Pricing hides metered views for subscription workspaces", () => {
  const html = renderToStaticMarkup(
    <BillingPricingSurface
      currency="usd"
      gpuEnabled
      snapshot={{ ...PRICING_SNAPSHOT, isPayg: false }}
    />
  );

  assertIncludes(html, "Subscription plans");
  assert.equal(html.includes("Price table"), false);
  assert.equal(html.includes("Price calculator"), false);
});

test("Pricing renders cluster currency and filters GPU catalog and price rows", () => {
  const withoutGpu = renderToStaticMarkup(
    <>
      <BillingPlanCatalog
        currency="cny"
        gpuEnabled={false}
        plans={PRICING_SNAPSHOT.plans}
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
  assertIncludes(withoutGpu, "¥0.010000");
  assert.equal(withoutGpu.includes("NVIDIA A100"), false);
  assert.equal(withoutGpu.includes(">GPU<"), false);

  const withGpu = renderToStaticMarkup(
    <>
      <BillingPlanCatalog
        currency="usd"
        gpuEnabled
        plans={PRICING_SNAPSHOT.plans}
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
});

test("Pricing preserves main and additional subscription plan catalog behavior", () => {
  const basePlan = PRICING_SNAPSHOT.plans[0];
  assert.ok(basePlan);
  const plans: BillingPricingPlan[] = [
    {
      ...basePlan,
      id: "hobby",
      name: "Hobby",
      order: 1,
    },
    {
      ...basePlan,
      id: "standard",
      monthlyOriginalPriceMicroUnits: 8_000_000,
      name: "Standard",
      order: 2,
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
      id: "enterprise",
      name: "Enterprise",
      order: 5,
      tags: ["more"],
    },
    {
      ...basePlan,
      id: "customized",
      name: "Customized",
      order: 0,
      tags: ["more"],
    },
  ];
  const html = renderToStaticMarkup(
    <BillingPlanCatalog currency="usd" gpuEnabled={false} plans={plans} />
  );

  assertTextOrder(html, ["Hobby", "Standard", "More plans", "Pro", "Team"]);
  for (const text of [
    "Most popular",
    "$8.00",
    "Priority Support",
    "All Hobby Features",
    "99.99% SLA",
    "24/7 Dedicated Support",
    "Custom Contracts",
  ]) {
    assertIncludes(html, text);
  }
  assert.equal(html.includes("Customized"), false);
  assert.equal(html.includes("Enterprise"), false);
});
