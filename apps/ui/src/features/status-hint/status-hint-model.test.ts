import assert from "node:assert/strict";
import { test } from "node:test";

import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";

import {
  evaluateStatusHints,
  reconcileDismissed,
  type StatusHintInputs,
  selectStatusHint,
} from "./status-hint-model";

const NOW = new Date("2026-08-25T12:00:00Z");

function subscription(
  overrides: Partial<WorkspaceSubscriptionSummary>
): WorkspaceSubscriptionSummary {
  return {
    currentPeriodEndAt: "2026-09-12T12:00:00Z",
    isActiveFreeTrial: false,
    isPayg: false,
    lifecycle: "active",
    planName: "Hobby",
    recoveryVoice: "renew",
    role: "OWNER",
    warningDeadlineAt: null,
    warningStage: null,
    ...overrides,
  };
}

const QUIET: StatusHintInputs = {
  availableBalanceMicroUnits: 50_000_000,
  now: NOW,
  quota: [
    { label: "CPU", percentUsed: 37.5, type: "cpu" },
    { label: "Memory", percentUsed: 75, type: "memory" },
    { label: "Storage", percentUsed: 60, type: "storage" },
    { label: "Ports", percentUsed: 25, type: "nodeport" },
    { label: "Traffic", percentUsed: 100, type: "traffic" },
  ],
  subscription: subscription({}),
};

const PAYMENT_DUE: Partial<WorkspaceSubscriptionSummary> = {
  currentPeriodEndAt: "2026-08-23T12:00:00Z",
  lifecycle: "payment-due",
  warningDeadlineAt: "2026-09-06T12:00:00Z",
  warningStage: "expired",
};

function ids(inputs: StatusHintInputs) {
  return evaluateStatusHints(inputs).hints.map((hint) => hint.id);
}

test("a quiet workspace holds no state and settles every input", () => {
  const evaluation = evaluateStatusHints(QUIET);
  assert.deepEqual(evaluation.hints, []);
  assert.deepEqual(evaluation.settled, [
    "payment-due",
    "account-debt",
    "quota-full",
    "trial-expiry",
  ]);
});

test("payment-due while suspended ships the settled strings with the derived deletion date", () => {
  const [hint] = evaluateStatusHints({
    ...QUIET,
    subscription: subscription(PAYMENT_DUE),
  }).hints;
  assert.deepEqual(hint, {
    cta: { href: "/billing", label: "Renew plan" },
    description:
      "This workspace is suspended. Resources will be deleted on Sep 6 unless the subscription is renewed.",
    dismissible: false,
    id: "payment-due",
    title: "Workspace suspended — payment due",
    tone: "destructive",
  });
});

test("payment-due stage progression changes copy and dates only — never the visuals", () => {
  const suspended = evaluateStatusHints({
    ...QUIET,
    subscription: subscription(PAYMENT_DUE),
  }).hints[0];
  const imminent = evaluateStatusHints({
    ...QUIET,
    subscription: subscription({
      ...PAYMENT_DUE,
      currentPeriodEndAt: "2026-08-15T12:00:00Z",
      warningDeadlineAt: "2026-08-29T12:00:00Z",
      warningStage: "deletion-imminent",
    }),
  }).hints[0];
  assert.ok(suspended && imminent);
  assert.equal(imminent.title, "Workspace suspended — deletion imminent");
  assert.equal(
    imminent.description,
    "Resources will be permanently deleted on Aug 29. This cannot be undone."
  );
  assert.equal(imminent.tone, suspended.tone);
  assert.equal(imminent.dismissible, suspended.dismissible);
  assert.deepEqual(imminent.cta, suspended.cta);
});

test("an expired Free trial never asks for a renewal", () => {
  const [hint] = evaluateStatusHints({
    ...QUIET,
    subscription: subscription({
      ...PAYMENT_DUE,
      planName: "Free",
      recoveryVoice: "resubscribe",
    }),
  }).hints;
  assert.ok(hint);
  assert.equal(hint.id, "payment-due");
  assert.deepEqual(hint.cta, {
    href: "/billing?mode=upgrade",
    label: "Upgrade plan",
  });
  assert.equal(
    hint.description,
    "This workspace is suspended. Resources will be deleted on Sep 6 unless you upgrade to a paid plan."
  );
});

test("a missing deadline speaks of deletion without inventing a date", () => {
  const [hint] = evaluateStatusHints({
    ...QUIET,
    subscription: subscription({ ...PAYMENT_DUE, warningDeadlineAt: null }),
  }).hints;
  assert.ok(hint);
  assert.equal(
    hint.description,
    "This workspace is suspended. Resources will be deleted soon unless the subscription is renewed."
  );
});

test("Account Debt lights up from the available balance and never mentions a subscription", () => {
  const [hint] = evaluateStatusHints({
    ...QUIET,
    availableBalanceMicroUnits: 0,
  }).hints;
  assert.deepEqual(hint, {
    cta: { href: "/billing", label: "Top up balance" },
    description:
      "Pay-as-you-go workspaces are suspended. Top up your balance to restore them.",
    dismissible: false,
    id: "account-debt",
    title: "Account balance in debt",
    tone: "destructive",
  });
});

test("a PAYG workspace reported in debt is Account Debt, not payment-due", () => {
  // The platform reports it as a DEBT status with no subscription and no
  // timestamps — CONTEXT.md: never voice it as a subscription expiring.
  assert.deepEqual(
    ids({
      ...QUIET,
      availableBalanceMicroUnits: null,
      subscription: subscription({
        isPayg: true,
        lifecycle: "payment-due",
        planName: "PAYG",
        warningStage: "expired",
      }),
    }),
    ["account-debt"]
  );
});

test("quota-full names the first full resource and is a warning, not red", () => {
  const [hint] = evaluateStatusHints({
    ...QUIET,
    quota: [
      { label: "CPU", percentUsed: 80, type: "cpu" },
      { label: "Memory", percentUsed: 100, type: "memory" },
      { label: "Storage", percentUsed: 100, type: "storage" },
    ],
  }).hints;
  assert.deepEqual(hint, {
    cta: { href: "/billing/usage", label: "View usage" },
    description:
      "New deployments can't start until memory is freed or the plan is upgraded.",
    dismissible: true,
    id: "quota-full",
    title: "Memory quota is full",
    tone: "warning",
  });
});

test("quota-full covers pods", () => {
  const [pods] = evaluateStatusHints({
    ...QUIET,
    quota: [{ label: "Pods", percentUsed: 100, type: "pod" }],
  }).hints;
  assert.equal(pods?.title, "Pods quota is full");
  assert.equal(
    pods?.description,
    "New deployments can't start until pods is freed or the plan is upgraded."
  );
});

test("quota-full keeps CPU capitalised and ignores traffic", () => {
  const [cpu] = evaluateStatusHints({
    ...QUIET,
    quota: [{ label: "CPU", percentUsed: 100, type: "cpu" }],
  }).hints;
  assert.equal(cpu?.title, "CPU quota is full");
  assert.equal(
    cpu?.description,
    "New deployments can't start until CPU is freed or the plan is upgraded."
  );
  assert.deepEqual(
    ids({
      ...QUIET,
      quota: [{ label: "Traffic", percentUsed: 100, type: "traffic" }],
    }),
    []
  );
});

test("trial-expiry opens three days before the Free trial ends and counts down", () => {
  const trial = (endsAt: string) =>
    evaluateStatusHints({
      ...QUIET,
      subscription: subscription({
        currentPeriodEndAt: endsAt,
        isActiveFreeTrial: true,
        planName: "Free",
      }),
    }).hints;
  assert.deepEqual(trial("2026-09-04T12:00:00Z"), []);
  assert.deepEqual(trial("2026-08-28T12:00:00Z"), [
    {
      cta: { href: "/billing?mode=upgrade", label: "View plans" },
      description:
        "Your workspace will be suspended when the trial ends on Aug 28. Upgrade to keep it running.",
      dismissible: true,
      id: "trial-expiry",
      title: "Free trial ends in 3 days",
      tone: "info",
    },
  ]);
  assert.equal(
    trial("2026-08-26T12:00:00Z")[0]?.title,
    "Free trial ends tomorrow"
  );
  assert.equal(
    trial("2026-08-25T12:30:00Z")[0]?.title,
    "Free trial ends today"
  );
  // Once expired, section B owns the flow.
  assert.deepEqual(trial("2026-08-24T12:00:00Z"), []);
});

test("severity orders payment-due > account-debt > quota-full > trial-expiry", () => {
  assert.deepEqual(
    ids({
      availableBalanceMicroUnits: -1,
      now: NOW,
      quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
      subscription: subscription(PAYMENT_DUE),
    }),
    ["payment-due", "account-debt", "quota-full"]
  );
  assert.deepEqual(
    ids({
      availableBalanceMicroUnits: -1,
      now: NOW,
      quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
      subscription: subscription({
        currentPeriodEndAt: "2026-08-27T12:00:00Z",
        isActiveFreeTrial: true,
        planName: "Free",
      }),
    }),
    ["account-debt", "quota-full", "trial-expiry"]
  );
});

test("unknown inputs neither light a state nor settle it", () => {
  const evaluation = evaluateStatusHints({
    availableBalanceMicroUnits: null,
    now: NOW,
    quota: null,
    subscription: null,
  });
  assert.deepEqual(evaluation.hints, []);
  assert.deepEqual(evaluation.settled, []);
  // The subscription alone settles the subscription-driven states.
  assert.deepEqual(
    evaluateStatusHints({
      availableBalanceMicroUnits: null,
      now: NOW,
      quota: null,
      subscription: subscription({}),
    }).settled,
    ["payment-due", "trial-expiry"]
  );
});

test("the single slot shows the most severe undismissed hint", () => {
  const { hints } = evaluateStatusHints({
    ...QUIET,
    quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
    subscription: subscription({
      currentPeriodEndAt: "2026-08-27T12:00:00Z",
      isActiveFreeTrial: true,
      planName: "Free",
    }),
  });
  assert.equal(selectStatusHint(hints, [])?.id, "quota-full");
  assert.equal(selectStatusHint(hints, ["quota-full"])?.id, "trial-expiry");
  assert.equal(selectStatusHint(hints, ["quota-full", "trial-expiry"]), null);
});

test("a suppressed state takes over when the higher one clears", () => {
  const withDebt = evaluateStatusHints({
    ...QUIET,
    availableBalanceMicroUnits: 0,
    quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
  });
  assert.equal(selectStatusHint(withDebt.hints, [])?.id, "account-debt");
  const recovered = evaluateStatusHints({
    ...QUIET,
    quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
  });
  assert.equal(selectStatusHint(recovered.hints, [])?.id, "quota-full");
});

test("dismissals survive while the state holds and revive on re-entry", () => {
  const full = evaluateStatusHints({
    ...QUIET,
    quota: [{ label: "Storage", percentUsed: 100, type: "storage" }],
  });
  const dismissed = ["quota-full", "trial-expiry"] as const;
  // Still full: the quota dismissal stands; the trial state is settled
  // absent, so its stale dismissal is forgotten.
  assert.deepEqual(reconcileDismissed(dismissed, full), ["quota-full"]);
  // Freed: the dismissal is forgotten, so the next fill shows the banner.
  assert.deepEqual(
    reconcileDismissed(["quota-full"], evaluateStatusHints(QUIET)),
    []
  );
  // Unknown quota: nothing is decided yet, so the dismissal is kept.
  assert.deepEqual(
    reconcileDismissed(
      ["quota-full"],
      evaluateStatusHints({ ...QUIET, quota: null })
    ),
    ["quota-full"]
  );
  // Reconciling is identity-stable when nothing changes.
  const stable = ["quota-full"] as const;
  assert.equal(reconcileDismissed(stable, full), stable);
});
