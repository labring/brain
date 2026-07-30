import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BillingCostsSurface } from "./billing-costs";
import type { BillingPlanSnapshot } from "./billing-plan-data";
import { BillingPlanSurface } from "./billing-plan-surface";
import { BillingPricingSurface } from "./billing-pricing";
import { BillingNavigationFrame } from "./billing-tab-shell";
import { BillingUsageSurface } from "./billing-usage";

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
  const html = renderToStaticMarkup(<BillingUsageSurface />);

  assertTextOrder(html, [
    "Workspace usage",
    "Resource",
    "Usage",
    "Total",
    "Used",
    "Remaining",
  ]);
  assertIncludes(html, "Select workspace");
});

test("Pricing preserves Cost Center's three pricing information layers", () => {
  const html = renderToStaticMarkup(<BillingPricingSurface />);

  assertTextOrder(html, [
    "Subscription plans",
    "Price table",
    "Price calculator",
  ]);
  assertIncludes(html, "Plan catalog");
});
