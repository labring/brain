import assert from "node:assert/strict";
import { test } from "node:test";

import { installTestDom } from "@/features/project-canvas/react-test-harness";

// Loaded with a DOM registered, matching the interaction tests' convention:
// importing a component graph (next/link etc.) without a DOM poisons React
// rendering for interaction test files that run later in the same process.
async function loadTabShell() {
  const dom = installTestDom();
  try {
    return await import("./billing-tab-shell");
  } finally {
    await dom.restore();
  }
}

test("billingTabFromPathname maps every Billing Area URL to its tab", async () => {
  const { billingTabFromPathname } = await loadTabShell();
  assert.equal(billingTabFromPathname("/billing"), "plan");
  assert.equal(billingTabFromPathname("/billing/"), "plan");
  assert.equal(billingTabFromPathname("/billing/costs"), "costs");
  assert.equal(billingTabFromPathname("/billing/usage"), "usage");
  assert.equal(billingTabFromPathname("/billing/pricing"), "pricing");
});

test("Billing Area exposes the settled four-tab navigation contract", async () => {
  const { BILLING_TABS } = await loadTabShell();
  assert.deepEqual(BILLING_TABS, [
    { href: "/billing", label: "Plan", value: "plan" },
    { href: "/billing/costs", label: "Costs", value: "costs" },
    { href: "/billing/usage", label: "Usage", value: "usage" },
    { href: "/billing/pricing", label: "Pricing", value: "pricing" },
  ]);
});
