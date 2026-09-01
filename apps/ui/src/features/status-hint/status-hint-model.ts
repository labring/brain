import {
  accountDebtFromMoney,
  accountDebtSuspends,
} from "@/features/billing/account-debt";
import type { WorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import type { BillingSurfaceTone } from "@/features/billing/billing-surface-tones";
import {
  type BillingUsageRow,
  firstFullQuotaRow,
  quotaResourceNoun,
  UNIVERSAL_DEPLOYABLE_QUOTA_TYPES,
} from "@/features/billing/billing-usage-data";
import type { NotificationCTA } from "@/features/shell/app-sidebar-notifications-model";
import { DAY_MS } from "@/lib/time";

/**
 * The status hint surface's domain model (design spec §7): which billing
 * states currently hold, in severity order, and the single-slot and
 * dismiss/revive rules the banner applies to them. Pure — the hook feeds it
 * already-proxied account, subscription, and quota reads.
 */

export type StatusHintId =
  | "payment-due"
  | "account-debt"
  | "quota-full"
  | "trial-expiry";

export type StatusHintTone = BillingSurfaceTone;

export interface StatusHint {
  /** The fix, deep-linking to the page that solves the problem. */
  cta: NotificationCTA;
  description: string;
  /** Critical, blocking, system-condition hints get no close button. */
  dismissible: boolean;
  id: StatusHintId;
  title: string;
  tone: StatusHintTone;
}

export type StatusHintQuotaRow = Pick<
  BillingUsageRow,
  "label" | "percentUsed" | "type"
>;

/** `null` marks an input that has not answered yet — unknown, not absent. */
export interface StatusHintInputs {
  /** Balance − DeductionBalance + usable credits, the platform's debt formula. */
  availableBalanceMicroUnits: number | null;
  /** Lifetime deductions — zero means the account has never been billed. */
  lifetimeDeductionMicroUnits: number | null;
  now: Date;
  quota: readonly StatusHintQuotaRow[] | null;
  subscription: WorkspaceSubscriptionSummary | null;
}

export interface StatusHintEvaluation {
  /** Every holding state, most severe first. */
  hints: StatusHint[];
  /** States whose inputs answered — their absence from `hints` is a fact. */
  settled: StatusHintId[];
}

/** Severity order: dunning > global suspension > hard stop > heads-up. */
const SEVERITY: readonly StatusHintId[] = [
  "payment-due",
  "account-debt",
  "quota-full",
  "trial-expiry",
];

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
});

/** The trial-expiry state opens this many days before the Free trial ends. */
export const TRIAL_EXPIRY_NOTICE_DAYS = 3;

function parsedDate(iso: string | null): Date | null {
  if (iso == null || iso.trim() === "") {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  return DATE_FORMATTER.format(date);
}

function paymentDueHint(
  subscription: WorkspaceSubscriptionSummary
): StatusHint | null {
  // A PAYG workspace in DEBT is Account Debt (no subscription, no dates).
  if (subscription.isPayg || subscription.lifecycle !== "payment-due") {
    return null;
  }
  // An unpriced Free plan is not a renewal target: its recovery is choosing
  // a paid plan, so the CTA opens the Plan Picker and never says "renew".
  const resubscribe = subscription.recoveryVoice === "resubscribe";
  const cta = resubscribe
    ? { href: "/billing?mode=upgrade", label: "Upgrade plan" }
    : { href: "/billing", label: "Renew plan" };
  const deadline = parsedDate(subscription.warningDeadlineAt);
  if (subscription.warningStage === "deletion-imminent") {
    // Copy advances with the stage; the visuals deliberately do not.
    return {
      cta,
      description:
        deadline == null
          ? "Resources will be permanently deleted soon. This cannot be undone."
          : `Resources will be permanently deleted on ${formatDate(deadline)}. This cannot be undone.`,
      dismissible: false,
      id: "payment-due",
      title: "Workspace suspended — deletion imminent",
      tone: "destructive",
    };
  }
  const when = deadline == null ? "soon" : `on ${formatDate(deadline)}`;
  const wayOut = resubscribe
    ? "unless you upgrade to a paid plan"
    : "unless the subscription is renewed";
  return {
    cta,
    description: `This workspace is suspended. Resources will be deleted ${when} ${wayOut}.`,
    dismissible: false,
    id: "payment-due",
    title: "Workspace suspended — payment due",
    tone: "destructive",
  };
}

const ACCOUNT_DEBT_HINT: StatusHint = {
  cta: { href: "/billing", label: "Top up balance" },
  description:
    "Pay-as-you-go workspaces are suspended. Top up your balance to restore them.",
  dismissible: false,
  id: "account-debt",
  title: "Account balance in debt",
  tone: "destructive",
};

/**
 * Whether Account Debt suspends this workspace — the state, shared with the
 * Deploy Billing Notice so the banner and the notice can never disagree.
 * The platform's debt pipeline stops only Pay-As-You-Go workspaces (a
 * subscribed workspace's resources ride its plan, and its zero balance must
 * not be voiced as debt — ADR-0068), and its state machine skips accounts
 * that have never been billed, so the state holds only where the platform
 * would actually suspend. The PAYG gate itself is `accountDebtSuspends`,
 * the one function the server-side standing also judges by (ADR-0069).
 */
export function accountDebtHolds(
  inputs: Pick<
    StatusHintInputs,
    | "availableBalanceMicroUnits"
    | "lifetimeDeductionMicroUnits"
    | "subscription"
  >
): boolean | null {
  const { subscription } = inputs;
  // A PAYG workspace the platform already reports in DEBT is the fact itself.
  const platformReported =
    subscription?.isPayg === true && subscription.lifecycle === "payment-due";
  const money =
    inputs.availableBalanceMicroUnits == null ||
    inputs.lifetimeDeductionMicroUnits == null
      ? null
      : accountDebtFromMoney({
          availableBalanceMicroUnits: inputs.availableBalanceMicroUnits,
          lifetimeDeductionMicroUnits: inputs.lifetimeDeductionMicroUnits,
        });
  return accountDebtSuspends({
    accountDebt: platformReported ? true : money,
    isPayg: subscription == null ? null : subscription.isPayg,
  });
}

function quotaFullHint(
  quota: readonly StatusHintQuotaRow[]
): StatusHint | null {
  const full = firstFullQuotaRow(quota);
  if (full == null) {
    return null;
  }
  const noun = quotaResourceNoun(full.label);
  return {
    cta: { href: "/billing/usage", label: "View usage" },
    // Storage and nodeport doom only workloads that request them, so their
    // banner must not claim every deployment fails (ADR-0069).
    description: UNIVERSAL_DEPLOYABLE_QUOTA_TYPES.has(full.type)
      ? `New deployments will fail until ${noun} is freed or the plan is upgraded.`
      : `Deployments requesting more ${noun} will fail until it is freed or the plan is upgraded.`,
    dismissible: true,
    id: "quota-full",
    title: `${full.label} quota is full`,
    tone: "warning",
  };
}

/** Whole calendar days from `now` to `target` in the viewer's time zone. */
function calendarDaysUntil(target: Date, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(
    target.getFullYear(),
    target.getMonth(),
    target.getDate()
  );
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

function trialEndsIn(days: number): string {
  if (days <= 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  return `in ${days} days`;
}

function trialExpiryHint(
  subscription: WorkspaceSubscriptionSummary,
  now: Date
): StatusHint | null {
  if (!subscription.isActiveFreeTrial) {
    return null;
  }
  const endsAt = parsedDate(subscription.currentPeriodEndAt);
  if (endsAt == null) {
    return null;
  }
  // Once expired, the payment-due pipeline owns the flow.
  if (endsAt.getTime() < now.getTime()) {
    return null;
  }
  const days = calendarDaysUntil(endsAt, now);
  if (days > TRIAL_EXPIRY_NOTICE_DAYS) {
    return null;
  }
  return {
    cta: { href: "/billing?mode=upgrade", label: "View plans" },
    description: `Your workspace will be suspended when the trial ends on ${formatDate(endsAt)}. Upgrade to keep it running.`,
    dismissible: true,
    id: "trial-expiry",
    title: `Free trial ends ${trialEndsIn(days)}`,
    tone: "info",
  };
}

export function evaluateStatusHints(
  inputs: StatusHintInputs
): StatusHintEvaluation {
  const { subscription } = inputs;
  const debt = accountDebtHolds(inputs);
  let accountDebt: StatusHint | null | undefined;
  if (debt != null) {
    accountDebt = debt ? ACCOUNT_DEBT_HINT : null;
  }
  const outcomes: Record<StatusHintId, StatusHint | null | undefined> = {
    "account-debt": accountDebt,
    "payment-due":
      subscription == null ? undefined : paymentDueHint(subscription),
    "quota-full":
      inputs.quota == null ? undefined : quotaFullHint(inputs.quota),
    "trial-expiry":
      subscription == null
        ? undefined
        : trialExpiryHint(subscription, inputs.now),
  };
  const hints: StatusHint[] = [];
  const settled: StatusHintId[] = [];
  for (const id of SEVERITY) {
    const outcome = outcomes[id];
    if (outcome === undefined) {
      continue;
    }
    settled.push(id);
    if (outcome != null) {
      hints.push(outcome);
    }
  }
  return { hints, settled };
}

/** The one hint the single slot shows, skipping user-dismissed ones. */
export function selectStatusHint(
  hints: readonly StatusHint[],
  dismissed: readonly StatusHintId[]
): StatusHint | null {
  return hints.find((hint) => !dismissed.includes(hint.id)) ?? null;
}

/**
 * Edge semantics for dismissals: a dismissal stands while its state holds
 * (or is still unknown) and is forgotten once the state is settled absent,
 * so the banner revives when the state re-enters. Returns the same array
 * when nothing changes, so stores can skip a write.
 */
export function reconcileDismissed(
  dismissed: readonly StatusHintId[],
  evaluation: StatusHintEvaluation
): readonly StatusHintId[] {
  const holding = new Set(evaluation.hints.map((hint) => hint.id));
  const next = dismissed.filter(
    (id) => holding.has(id) || !evaluation.settled.includes(id)
  );
  return next.length === dismissed.length ? dismissed : next;
}
