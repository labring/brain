import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountBalanceMicroUnits } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { loadWorkspaceQuotaUsage } from "@/features/billing/billing-usage-data";
import type { BillingDevScenario } from "@/features/billing/dev-mock-cookie";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";
import type { StatusHintInputs } from "@/features/status-hint/status-hint-model";

import { resolveDeployBillingWall } from "./deploy-billing-wall";

/**
 * The pre-deploy wall (design spec rows E1/E2) is the same judgment the
 * status hint makes from the same reads, so the fixtures that light the
 * banner are the ones that wall the deploy entry.
 */

const NOW = new Date("2026-08-28T10:00:00Z");
const CREDENTIALS = {
  appToken: "test-token",
  kubeconfig: "test-kubeconfig",
  workspace: "ns-test",
};

const QUIET: StatusHintInputs = {
  availableBalanceMicroUnits: 50_000_000,
  now: NOW,
  quota: [
    { label: "CPU", percentUsed: 37.5, type: "cpu" },
    { label: "Storage", percentUsed: 60, type: "storage" },
    { label: "Traffic", percentUsed: 100, type: "traffic" },
  ],
  subscription: null,
};

async function inputsFor(
  scenario: BillingDevScenario
): Promise<StatusHintInputs> {
  const fetch = scenarioTestFetch(scenario);
  const [subscription, balance, credits, quota] = await Promise.all([
    loadWorkspaceSubscriptionSummary(CREDENTIALS, { fetch }),
    loadAccountBalanceMicroUnits(CREDENTIALS, fetch),
    loadAccountCredits(CREDENTIALS, fetch),
    loadWorkspaceQuotaUsage(CREDENTIALS, fetch),
  ]);
  return {
    availableBalanceMicroUnits: balance + credits.usableMicroUnits,
    now: NOW,
    quota,
    subscription,
  };
}

test("a quiet workspace is not walled; traffic never counts", () => {
  assert.equal(resolveDeployBillingWall(QUIET), null);
});

test("Account Debt walls the entry with the top-up voice", () => {
  const wall = resolveDeployBillingWall({
    ...QUIET,
    availableBalanceMicroUnits: -6_320_000,
  });
  assert.deepEqual(wall, {
    body: "Pay-as-you-go workspaces are suspended, so new deployments can't start. Top up your balance to restore them.",
    cta: { href: "/billing", label: "Top up balance" },
    kind: "balance",
    title: "Account balance in debt",
  });
});

test("a full deployable quota walls the entry naming the resource", () => {
  const wall = resolveDeployBillingWall({
    ...QUIET,
    quota: [
      { label: "CPU", percentUsed: 40, type: "cpu" },
      { label: "Storage", percentUsed: 100, type: "storage" },
    ],
  });
  assert.deepEqual(wall, {
    body: "New deployments can't start until storage is freed or the plan is upgraded.",
    cta: { href: "/billing/usage", label: "View usage" },
    kind: "quota",
    title: "Storage quota is full",
  });
});

test("a low-but-positive balance is not a wall", () => {
  assert.equal(
    resolveDeployBillingWall({ ...QUIET, availableBalanceMicroUnits: 400_000 }),
    null
  );
});

test("unknown inputs never wall", () => {
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: null,
      quota: null,
    }),
    null
  );
});

test("the billing fixtures wall exactly the scenarios the banner lights for debt or quota", async () => {
  assert.equal(
    resolveDeployBillingWall(await inputsFor("payg"))?.kind,
    undefined
  );
  assert.equal(
    resolveDeployBillingWall(await inputsFor("payg-debt"))?.kind,
    "balance"
  );
  assert.equal(
    resolveDeployBillingWall(await inputsFor("quota-full"))?.kind,
    "quota"
  );
  assert.equal(resolveDeployBillingWall(await inputsFor("active")), null);
});
