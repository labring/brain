import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountBalanceTerms } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import {
  loadWorkspaceSubscriptionSummary,
  type WorkspaceSubscriptionSummary,
} from "@/features/billing/billing-plan-data";
import { loadWorkspaceQuotaUsage } from "@/features/billing/billing-usage-data";
import type { BillingDevScenario } from "@/features/billing/dev-mock-cookie";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";
import type { StatusHintInputs } from "@/features/status-hint/status-hint-model";

import {
  deployBillingWallFromStanding,
  resolveDeployBillingWall,
} from "./deploy-billing-wall";

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

const PAYG: WorkspaceSubscriptionSummary = {
  currentPeriodEndAt: "",
  isActiveFreeTrial: false,
  isPayg: true,
  lifecycle: "active",
  planName: "PAYG",
  recoveryVoice: "renew",
  role: null,
  warningDeadlineAt: null,
  warningStage: null,
};
const HOBBY: WorkspaceSubscriptionSummary = {
  ...PAYG,
  isPayg: false,
  planName: "Hobby",
  role: "OWNER",
};

const QUIET: StatusHintInputs = {
  availableBalanceMicroUnits: 50_000_000,
  lifetimeDeductionMicroUnits: 23_450_000,
  now: NOW,
  quota: [
    { label: "CPU", percentUsed: 37.5, type: "cpu" },
    { label: "Storage", percentUsed: 60, type: "storage" },
    { label: "Traffic", percentUsed: 100, type: "traffic" },
  ],
  subscription: PAYG,
};

async function inputsFor(
  scenario: BillingDevScenario
): Promise<StatusHintInputs> {
  const fetch = scenarioTestFetch(scenario);
  const [subscription, balance, credits, quota] = await Promise.all([
    loadWorkspaceSubscriptionSummary(CREDENTIALS, { fetch }),
    loadAccountBalanceTerms(CREDENTIALS, fetch),
    loadAccountCredits(CREDENTIALS, fetch),
    loadWorkspaceQuotaUsage(CREDENTIALS, fetch),
  ]);
  return {
    availableBalanceMicroUnits:
      balance.cashMicroUnits + credits.usableMicroUnits,
    lifetimeDeductionMicroUnits: balance.lifetimeDeductionMicroUnits,
    now: NOW,
    quota,
    subscription,
  };
}

test("the server-side standing judges the same wall the panes do", () => {
  const base = {
    accountDebt: false,
    aiCredits: null,
    availableBalanceMicroUnits: 50_000_000,
    fullQuota: null,
    paidSource: "balance" as const,
    quotaKnown: true,
  };
  assert.equal(deployBillingWallFromStanding(base), null);
  assert.equal(
    deployBillingWallFromStanding({ ...base, accountDebt: true })?.kind,
    "balance"
  );
  assert.equal(
    deployBillingWallFromStanding({
      ...base,
      fullQuota: { label: "Pods", percentUsed: 100, type: "pod" },
    })?.title,
    "Pods quota is full"
  );
  assert.equal(
    deployBillingWallFromStanding({ ...base, accountDebt: null }),
    null
  );
  // Account Debt suspends only PAYG workspaces: a subscriber's account in
  // debt, or a workspace whose paid source is unknown, is never walled on it.
  assert.equal(
    deployBillingWallFromStanding({
      ...base,
      accountDebt: true,
      paidSource: "ai-credits",
    }),
    null
  );
  assert.equal(
    deployBillingWallFromStanding({
      ...base,
      accountDebt: true,
      paidSource: null,
    }),
    null
  );
});

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

test("a subscribed workspace is never walled on its account's debt", () => {
  // Banner and wall share one predicate: Account Debt holds only where the
  // platform actually suspends for it. A subscriber at zero balance
  // (its $1 gift credit expired) keeps deploying; so does one under the
  // Deletion Countdown — that story belongs to the payment-due hint.
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: 0,
      subscription: HOBBY,
    }),
    null
  );
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      subscription: { ...HOBBY, lifecycle: "payment-due" },
    }),
    null
  );
  // …but a full quota still walls it.
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
      subscription: HOBBY,
    })?.kind,
    "quota"
  );
});

test("a never-billed zero-balance account is not walled — the platform skips it", () => {
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: 0,
      lifetimeDeductionMicroUnits: 0,
    }),
    null
  );
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
  assert.equal(
    resolveDeployBillingWall({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      subscription: null,
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
  // The payment-due fixture's account is in debt too; the wall is not its voice.
  assert.equal(resolveDeployBillingWall(await inputsFor("payment-due")), null);
});
