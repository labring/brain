import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountBalanceTerms } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { loadWorkspaceQuotaUsage } from "@/features/billing/billing-usage-data";
import {
  BILLING_DEV_SCENARIOS,
  type BillingDevScenario,
} from "@/features/billing/dev-mock-cookie";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";

import {
  evaluateStatusHints,
  type StatusHintId,
  selectStatusHint,
} from "./status-hint-model";

/**
 * Pins the banner states to the dev fixtures through the same loaders the
 * hook uses, so every state the design catalogs can be simulated locally
 * and the fixtures keep meaning what their names promise.
 */

const DATED_DELETION_PATTERN = /deleted on [A-Z][a-z]{2} \d/;
const RENEWAL_PATTERN = /renew/i;

const CREDENTIALS = {
  appToken: "test-token",
  kubeconfig: "test-kubeconfig",
  workspace: "ns-test",
};

async function hintFor(scenario: BillingDevScenario) {
  const fetch = scenarioTestFetch(scenario);
  const [subscription, balance, credits, quota] = await Promise.all([
    loadWorkspaceSubscriptionSummary(CREDENTIALS, { fetch }),
    loadAccountBalanceTerms(CREDENTIALS, fetch),
    loadAccountCredits(CREDENTIALS, fetch),
    loadWorkspaceQuotaUsage(CREDENTIALS, fetch),
  ]);
  const evaluation = evaluateStatusHints({
    availableBalanceMicroUnits:
      balance.cashMicroUnits + credits.usableMicroUnits,
    lifetimeDeductionMicroUnits: balance.lifetimeDeductionMicroUnits,
    now: new Date(),
    quota,
    subscription,
  });
  assert.deepEqual(
    evaluation.settled,
    ["payment-due", "account-debt", "quota-full", "trial-expiry"],
    `${scenario}: every input answers`
  );
  return { evaluation, hint: selectStatusHint(evaluation.hints, []) };
}

const EXPECTED: Record<BillingDevScenario, StatusHintId | null> = {
  active: null,
  "active-balance": null,
  "ai-credits-exhausted": null,
  cancelling: null,
  deleted: null,
  free: null,
  "free-expired": "payment-due",
  "free-expiring": "trial-expiry",
  "mixed-workspaces": null,
  paused: null,
  payg: null,
  "payg-debt": "account-debt",
  "payg-debt-deletion": "account-debt",
  "payg-debt-final": "account-debt",
  "payment-due": "payment-due",
  "payment-due-deletion": "payment-due",
  "payment-due-final": "payment-due",
  "pending-upgrade": null,
  "quota-full": "quota-full",
  "status-unknown": null,
};

test("every scenario lands on the banner state its name promises", async () => {
  for (const scenario of BILLING_DEV_SCENARIOS) {
    const { hint } = await hintFor(scenario);
    assert.equal(hint?.id ?? null, EXPECTED[scenario], `${scenario}: slot`);
  }
});

test("the payment-due scenarios walk the stages with identical visuals", async () => {
  const suspended = (await hintFor("payment-due")).hint;
  const deletion = (await hintFor("payment-due-deletion")).hint;
  const final = (await hintFor("payment-due-final")).hint;
  assert.equal(suspended?.title, "Workspace suspended — payment due");
  assert.match(suspended?.description ?? "", DATED_DELETION_PATTERN);
  assert.equal(deletion?.title, "Workspace suspended — deletion imminent");
  assert.equal(final?.title, "Workspace suspended — deletion imminent");
  for (const stage of [deletion, final]) {
    assert.equal(stage?.tone, suspended?.tone);
    assert.equal(stage?.dismissible, false);
    assert.deepEqual(stage?.cta, suspended?.cta);
  }
  // The fixture's account is in debt too, but a subscribed workspace never
  // voices Account Debt (ADR-0068) — the Deletion Countdown owns the flow.
  const { evaluation } = await hintFor("payment-due");
  assert.deepEqual(
    evaluation.hints.map((hint) => hint.id),
    ["payment-due"]
  );
});

test("an expired Free trial asks for an upgrade, never a renewal", async () => {
  const { hint } = await hintFor("free-expired");
  assert.deepEqual(hint?.cta, {
    href: "/billing?mode=upgrade",
    label: "Upgrade plan",
  });
  assert.doesNotMatch(hint?.description ?? "", RENEWAL_PATTERN);
});

test("quota-full names the first full quota (CPU) and stays a warning", async () => {
  // The fixture maxes CPU and storage; CPU sits first in the quota rows and
  // is a universal deployable quota, so it is the banner's voice (ADR-0070).
  const { hint } = await hintFor("quota-full");
  assert.equal(hint?.title, "CPU quota is full");
  assert.equal(hint?.tone, "warning");
  assert.equal(hint?.dismissible, true);
});

test("free-expiring sits inside the three-day trial notice", async () => {
  const { hint } = await hintFor("free-expiring");
  assert.equal(hint?.title, "Free trial ends in 3 days");
  assert.equal(hint?.tone, "info");
  assert.equal(hint?.cta.href, "/billing?mode=upgrade");
});
