import type { RecoveryVoice } from "@/features/billing/billing-plan-data";
import {
  type BillingQuotaType,
  firstDoomingQuotaRow,
  type QuotaFullnessRow,
  quotaResourceNoun,
} from "@/features/billing/billing-usage-data";
import {
  debtSuspendsWorkspace,
  type WorkspaceBillingStanding,
} from "@/features/billing/server/billing-standing-core";
import {
  accountDebtHolds,
  type StatusHintInputs,
} from "@/features/status-hint/status-hint-model";

/**
 * The Deploy Billing Notice (ADR-0069, formerly the Deploy Billing Wall):
 * an advisory callout above a still-usable deployment form while a
 * condition dooms every deployment the pane could start — Account Debt on a
 * Pay-As-You-Go workspace, a payment-due Workspace Subscription, or a full
 * quota among those every workload consumes (cpu/memory/pod, plus any the
 * pane's every request includes). It informs and never blocks: enforcement
 * lives at the platform, and a pressed-through run fails there and comes
 * back explained as a Billing Interruption. It is the same judgment the
 * status hint makes from the same reads; a low-but-positive balance never
 * notices, unknown facts never notice (every seam fails open, ADR-0068).
 * Pure.
 */
export interface DeployBillingNotice {
  body: string;
  cta: { href: string; label: string };
  kind: "balance" | "payment-due" | "quota";
  title: string;
}

export interface DeployBillingNoticeFacts {
  debtSuspended: boolean | null;
  full: QuotaFullnessRow | null;
  /** How payment-due recovery speaks; false when not payment-due, null unknown. */
  paymentDue: RecoveryVoice | false | null;
}

// Exported for the pane's dev tweak, which forges facts rather than copy so
// a forced card can never drift from what ships.
export function noticeFor(
  facts: DeployBillingNoticeFacts
): DeployBillingNotice | null {
  // Severity mirrors the status hint banner (payment-due > debt > quota),
  // so the banner and the notice can never voice different states.
  if (facts.paymentDue === "renew" || facts.paymentDue === "resubscribe") {
    const resubscribe = facts.paymentDue === "resubscribe";
    return {
      body: resubscribe
        ? "This workspace is suspended, so deployments will fail. Upgrade to a paid plan to restore it."
        : "This workspace is suspended, so deployments will fail. Renew the plan to restore it.",
      cta: resubscribe
        ? { href: "/billing?mode=upgrade", label: "Upgrade plan" }
        : { href: "/billing", label: "Renew plan" },
      kind: "payment-due",
      title: "Workspace suspended — payment due",
    };
  }
  if (facts.debtSuspended === true) {
    return {
      body: "Pay-as-you-go workspaces are suspended, so deployments will fail. Top up your balance to restore them.",
      cta: { href: "/billing", label: "Top up balance" },
      kind: "balance",
      title: "Account balance in debt",
    };
  }
  if (facts.full == null) {
    return null;
  }
  return {
    body: `New deployments will fail until ${quotaResourceNoun(facts.full.label)} is freed or the plan is upgraded.`,
    cta: { href: "/billing/usage", label: "View usage" },
    kind: "quota",
    title: `${facts.full.label} quota is full`,
  };
}

/**
 * The notice as the panes judge it, from the status hint's client-side
 * inputs. `paneConsumes` names quota types this pane's every deploy request
 * includes (the database pane's presets all carry storage), which then doom
 * like the universal set.
 */
function paymentDueVoice(
  subscription: StatusHintInputs["subscription"]
): RecoveryVoice | false | null {
  if (subscription == null) {
    return null;
  }
  // A PAYG record the platform reports on the debt ladder is Account Debt,
  // not a subscription expiry — the balance voice owns it.
  return !subscription.isPayg && subscription.lifecycle === "payment-due"
    ? subscription.recoveryVoice
    : false;
}

export function resolveDeployBillingNotice(
  inputs: StatusHintInputs,
  options: { paneConsumes?: readonly BillingQuotaType[] } = {}
): DeployBillingNotice | null {
  return noticeFor({
    debtSuspended: accountDebtHolds(inputs),
    full:
      inputs.quota == null
        ? null
        : firstDoomingQuotaRow(inputs.quota, options.paneConsumes ?? []),
    paymentDue: paymentDueVoice(inputs.subscription),
  });
}

/**
 * The same notice as the server judges it, for deploy entries that never
 * render a pane — the assistant's deploy tool, which relays it as a refusal
 * rather than an advisory (ADR-0069: the assistant must not silently spend
 * a doomed run).
 */
function standingPaymentDueVoice(
  standing: Pick<WorkspaceBillingStanding, "paymentDue" | "paymentDueRecovery">
): RecoveryVoice | false | null {
  if (standing.paymentDue == null) {
    return null;
  }
  return standing.paymentDue ? (standing.paymentDueRecovery ?? "renew") : false;
}

export function deployBillingNoticeFromStanding(
  standing: WorkspaceBillingStanding
): DeployBillingNotice | null {
  return noticeFor({
    debtSuspended: debtSuspendsWorkspace(standing),
    full: standing.fullUniversalQuota,
    paymentDue: standingPaymentDueVoice(standing),
  });
}
