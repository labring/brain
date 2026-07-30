import assert from "node:assert/strict";
import { test } from "node:test";

import { BILLING_TABS, billingTabFromPathname } from "./billing-tab-shell";

test("billingTabFromPathname maps every Billing Area URL to its tab", () => {
  assert.equal(billingTabFromPathname("/billing"), "plan");
  assert.equal(billingTabFromPathname("/billing/"), "plan");
  assert.equal(billingTabFromPathname("/billing/costs"), "costs");
  assert.equal(billingTabFromPathname("/billing/usage"), "usage");
  assert.equal(billingTabFromPathname("/billing/pricing"), "pricing");
});

test("Billing Area exposes the settled four-tab navigation contract", () => {
  assert.deepEqual(BILLING_TABS, [
    { href: "/billing", label: "Plan", value: "plan" },
    { href: "/billing/costs", label: "Costs", value: "costs" },
    { href: "/billing/usage", label: "Usage", value: "usage" },
    { href: "/billing/pricing", label: "Pricing", value: "pricing" },
  ]);
});
