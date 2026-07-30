import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BillingCostsSurface } from "./billing-costs";
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
    <BillingPlanSurface balance={<span>$3.00</span>} />
  );

  assertTextOrder(html, [
    "Current workspace plan",
    "Account Balance",
    "Payment method",
    "All plans",
  ]);
  assertIncludes(html, "$3.00");
  assertIncludes(html, 'data-slot="billing-plan-summary"');
  assertIncludes(html, 'data-slot="billing-balance-section"');
  assertIncludes(html, 'data-slot="billing-payment-method-section"');
  assertIncludes(html, 'data-slot="billing-all-plans-section"');
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
