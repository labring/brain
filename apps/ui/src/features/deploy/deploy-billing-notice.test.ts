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
import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";
import type { StatusHintInputs } from "@/features/status-hint/status-hint-model";

import {
  deployBillingNoticeFromStanding,
  resolveDeployBillingNotice,
} from "./deploy-billing-notice";
import { forcedDeployBillingNotice } from "./deploy-billing-notice-tweaks";

/**
 * The pre-deploy notice (ADR-0069) is the same judgment the status hint
 * makes from the same reads, so the fixtures that light the banner are the
 * ones that voice the deploy entry — advisory now, never a block.
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

const QUIET_STANDING: WorkspaceBillingStanding = {
  accountDebt: false,
  aiCredits: null,
  availableBalanceMicroUnits: 50_000_000,
  fullQuota: null,
  fullUniversalQuota: null,
  paidSource: "balance",
  paymentDue: false,
  paymentDueRecovery: null,
  quotaKnown: true,
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

test("the server-side standing judges the same notice the panes do", () => {
  assert.equal(deployBillingNoticeFromStanding(QUIET_STANDING), null);
  assert.equal(
    deployBillingNoticeFromStanding({ ...QUIET_STANDING, accountDebt: true })
      ?.kind,
    "balance"
  );
  assert.equal(
    deployBillingNoticeFromStanding({
      ...QUIET_STANDING,
      fullQuota: { label: "Pods", percentUsed: 100, type: "pod" },
      fullUniversalQuota: { label: "Pods", percentUsed: 100, type: "pod" },
    })?.title,
    "Pods quota is full"
  );
  // A full storage quota dooms only workloads that request storage, so it is
  // not the notice's voice (ADR-0069) — form validation speaks instead.
  assert.equal(
    deployBillingNoticeFromStanding({
      ...QUIET_STANDING,
      fullQuota: { label: "Storage", percentUsed: 100, type: "storage" },
    }),
    null
  );
  assert.equal(
    deployBillingNoticeFromStanding({ ...QUIET_STANDING, accountDebt: null }),
    null
  );
  // Account Debt suspends only PAYG workspaces: a subscriber's account in
  // debt, or a workspace whose paid source is unknown, is never noticed on it.
  assert.equal(
    deployBillingNoticeFromStanding({
      ...QUIET_STANDING,
      accountDebt: true,
      paidSource: "ai-credits",
    }),
    null
  );
  assert.equal(
    deployBillingNoticeFromStanding({
      ...QUIET_STANDING,
      accountDebt: true,
      paidSource: null,
    }),
    null
  );
});

test("a payment-due subscription is noticed with its recovery voice (ADR-0069)", () => {
  const renew = deployBillingNoticeFromStanding({
    ...QUIET_STANDING,
    paidSource: "ai-credits",
    paymentDue: true,
    paymentDueRecovery: "renew",
  });
  assert.equal(renew?.kind, "payment-due");
  assert.equal(renew?.cta.label, "Renew plan");
  // An expired Free plan is not a renewal target: its voice upgrades.
  const resubscribe = deployBillingNoticeFromStanding({
    ...QUIET_STANDING,
    paidSource: "ai-credits",
    paymentDue: true,
    paymentDueRecovery: "resubscribe",
  });
  assert.equal(resubscribe?.cta.label, "Upgrade plan");
  // Payment-due outranks a full quota, mirroring the banner's severity.
  assert.equal(
    deployBillingNoticeFromStanding({
      ...QUIET_STANDING,
      fullUniversalQuota: { label: "CPU", percentUsed: 100, type: "cpu" },
      paidSource: "ai-credits",
      paymentDue: true,
      paymentDueRecovery: "renew",
    })?.kind,
    "payment-due"
  );
});

test("a quiet workspace is not noticed; traffic never counts", () => {
  assert.equal(resolveDeployBillingNotice(QUIET), null);
});

test("Account Debt notices the entry with the top-up voice", () => {
  const notice = resolveDeployBillingNotice({
    ...QUIET,
    availableBalanceMicroUnits: -6_320_000,
  });
  assert.deepEqual(notice, {
    body: "Pay-as-you-go workspaces are suspended, so deployments will fail. Top up your balance to restore them.",
    cta: {
      desktop: { app: "system-costcenter", label: "Top up in Sealos Desktop" },
      href: "/billing",
      label: "Top up balance",
    },
    kind: "balance",
    title: "Account balance in debt",
  });
});

test("a full universal quota notices the entry naming the resource", () => {
  const notice = resolveDeployBillingNotice({
    ...QUIET,
    quota: [
      { label: "CPU", percentUsed: 40, type: "cpu" },
      { label: "Pods", percentUsed: 100, type: "pod" },
    ],
  });
  assert.deepEqual(notice, {
    body: "New deployments will fail until pods is freed or the plan is upgraded.",
    // A PAYG workspace subscribes rather than upgrades; usage stays the
    // quiet second way out.
    cta: { href: "/billing?mode=upgrade", label: "Subscribe" },
    kind: "quota",
    secondaryCta: { href: "/billing/usage", label: "View usage" },
    title: "Pods quota is full",
  });
});

test("the quota CTA forks on the subscription and steps aside at the plan ceiling", () => {
  const full: StatusHintInputs["quota"] = [
    { label: "Pods", percentUsed: 100, type: "pod" },
  ];
  // A subscribed workspace upgrades.
  const subscribed = resolveDeployBillingNotice({
    ...QUIET,
    quota: full,
    subscription: HOBBY,
  });
  assert.deepEqual(subscribed?.cta, {
    href: "/billing?mode=upgrade",
    label: "Upgrade plan",
  });
  assert.deepEqual(subscribed?.secondaryCta, {
    href: "/billing/usage",
    label: "View usage",
  });
  // A confirmed plan ceiling has no plan to sell: usage is the only way out.
  const ceiling = resolveDeployBillingNotice({
    ...QUIET,
    planCeiling: true,
    quota: full,
    subscription: HOBBY,
  });
  assert.deepEqual(ceiling?.cta, {
    href: "/billing/usage",
    label: "View usage",
  });
  assert.equal(ceiling?.secondaryCta, undefined);
});

test("a full storage quota is not the notice's voice — unless the pane's every deploy requests storage", () => {
  const inputs: StatusHintInputs = {
    ...QUIET,
    quota: [
      { label: "CPU", percentUsed: 40, type: "cpu" },
      { label: "Storage", percentUsed: 100, type: "storage" },
    ],
  };
  assert.equal(resolveDeployBillingNotice(inputs), null);
  // The database pane's presets all include storage (ADR-0069).
  assert.equal(
    resolveDeployBillingNotice(inputs, { paneConsumes: ["storage"] })?.title,
    "Storage quota is full"
  );
});

test("a subscribed workspace is never noticed on its account's debt", () => {
  // Banner and notice share one predicate: Account Debt holds only where
  // the platform actually suspends for it. A subscriber at zero balance
  // (its $1 gift credit expired) keeps deploying quietly.
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: 0,
      subscription: HOBBY,
    }),
    null
  );
  // …but one under the Deletion Countdown is payment-due: suspended, so the
  // deploy is doomed and the notice says so (ADR-0069 closed this gap).
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      subscription: { ...HOBBY, lifecycle: "payment-due" },
    })?.kind,
    "payment-due"
  );
  // A full universal quota still notices it.
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      quota: [{ label: "CPU", percentUsed: 100, type: "cpu" }],
      subscription: HOBBY,
    })?.kind,
    "quota"
  );
});

test("a PAYG workspace the platform reports in DEBT is Account Debt, not payment-due", () => {
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      subscription: { ...PAYG, lifecycle: "payment-due" },
    })?.kind,
    "balance"
  );
});

test("a never-billed zero-balance account is not noticed — the platform skips it", () => {
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: 0,
      lifetimeDeductionMicroUnits: 0,
    }),
    null
  );
});

test("a low-but-positive balance is not a notice", () => {
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: 400_000,
    }),
    null
  );
});

test("unknown inputs never notice", () => {
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: null,
      quota: null,
    }),
    null
  );
  assert.equal(
    resolveDeployBillingNotice({
      ...QUIET,
      availableBalanceMicroUnits: -6_320_000,
      subscription: null,
    }),
    null
  );
});

test("the billing fixtures notice exactly the scenarios the banner lights for debt, quota, or payment-due", async () => {
  assert.equal(
    resolveDeployBillingNotice(await inputsFor("payg"))?.kind,
    undefined
  );
  assert.equal(
    resolveDeployBillingNotice(await inputsFor("payg-debt"))?.kind,
    "balance"
  );
  assert.equal(
    resolveDeployBillingNotice(await inputsFor("quota-full"))?.kind,
    "quota"
  );
  assert.equal(resolveDeployBillingNotice(await inputsFor("active")), null);
  // The payment-due fixture's workspace is suspended under its expired
  // subscription: since ADR-0069 the notice voices that too.
  assert.equal(
    resolveDeployBillingNotice(await inputsFor("payment-due"))?.kind,
    "payment-due"
  );
});

test("the dev tweak's forced options each render a real card, and anything else none", () => {
  assert.equal(forcedDeployBillingNotice("balance")?.kind, "balance");
  assert.equal(
    forcedDeployBillingNotice("payment-due-renew")?.cta.label,
    "Renew plan"
  );
  assert.equal(
    forcedDeployBillingNotice("payment-due-resubscribe")?.cta.label,
    "Upgrade plan"
  );
  assert.equal(forcedDeployBillingNotice("quota")?.title, "CPU quota is full");
  assert.equal(forcedDeployBillingNotice("off"), null);
  assert.equal(forcedDeployBillingNotice("toString"), null);
});
