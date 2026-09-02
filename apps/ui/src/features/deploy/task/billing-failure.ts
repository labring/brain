import {
  debtSuspendsWorkspace,
  type WorkspaceBillingStanding,
} from "@/features/billing/server/billing-standing-core";

import type { DeployBillingEvidence, DeployTaskFailureReason } from "./schema";

/**
 * The billing reverse-check at a deployment's terminal failure (design spec
 * rows E1/E2). A suspended workspace or an unschedulable pod shows the
 * runner nothing but a stall, so the failure is classified by re-reading
 * the workspace's billing standing — the same judgment the pre-deploy wall
 * makes. Pure: the runner hands in the attached reason and the standing.
 */

export interface BillingFailureOverride {
  billingEvidence: DeployBillingEvidence;
  reason: DeployTaskFailureReason;
  /**
   * Whether the override names a cause the runner never saw. The runner's
   * own text was then only a stall (a timeout, a pod that never came up)
   * that contradicts the headline, so the curated reason replaces it on
   * every runner. False only for an apply-time error the platform explained
   * itself: the provider's quota error, which keeps the requested/used/limited
   * numbers, and the debt webhook's billing denial (ADR-0072), which keeps
   * the platform's own text.
   */
  supersedesRunnerError: boolean;
}

/**
 * Failures whose cause is already proven at their boundary; money never
 * rewrites them. Everything else — timeouts, runtime waits, apply and
 * gateway errors, unknowns — may have been the platform pulling the plug.
 */
const PROVEN_ELSEWHERE: ReadonlySet<DeployTaskFailureReason> = new Set([
  "cancelled",
  "interrupted",
  "github-authentication",
  "repository-clone-failed",
  "deploy-configuration-invalid",
  "image-build-failed",
  "deploy-skill-install-failed",
  "template-output-invalid",
  "deployment-output-missing",
]);

/**
 * Failures that look like a stall: nothing was proven wrong, something
 * simply never came up. Only these may be attributed to a full quota (an
 * unschedulable pod); an apply error keeps the truth the provider told.
 */
const STALL_SHAPED: ReadonlySet<DeployTaskFailureReason | "none"> = new Set([
  "none",
  "unknown",
  "timeout",
  "readiness-timeout",
  "deploy-runtime-unavailable",
  "build-runtime-unavailable",
  "gateway-timeout",
  "runner-error",
]);

/**
 * The one Billing Interruption the platform DOES signal: its admission
 * webhook (`debt.sealos.io`) denies the apply and names the cause in the
 * error text. Matched on the webhook's identity, not its wording — the
 * message copy has already changed across platform versions. Classified at
 * the apply boundary so the reason survives every reverse-check breakpoint
 * (a run without a Workspace Actor, an unreadable standing); the standing
 * judgment still refines it with Billing Evidence when it can (ADR-0072). A denial
 * that names neither a subscription nor a balance (the platform's
 * namespace-suspension wording covers both causes) stays unclassified —
 * a wrong billing CTA is worse than none.
 */
const DEBT_WEBHOOK_DENIAL_RE =
  /admission webhook \\?"?debt\.sealos\.io\\?"? denied/i;
const DENIAL_NAMES_SUBSCRIPTION_RE = /subscription/i;
const DENIAL_NAMES_BALANCE_RE = /balance/i;

export function billingDenialReason(
  message: string
): Extract<
  DeployTaskFailureReason,
  "balance-exhausted" | "subscription-expired"
> | null {
  if (!DEBT_WEBHOOK_DENIAL_RE.test(message)) {
    return null;
  }
  if (DENIAL_NAMES_SUBSCRIPTION_RE.test(message)) {
    return "subscription-expired";
  }
  if (DENIAL_NAMES_BALANCE_RE.test(message)) {
    return "balance-exhausted";
  }
  return null;
}

export function resolveBillingFailureOverride(input: {
  now: Date;
  reason: DeployTaskFailureReason | null;
  standing: WorkspaceBillingStanding;
}): BillingFailureOverride | null {
  const { reason, standing } = input;
  if (reason != null && PROVEN_ELSEWHERE.has(reason)) {
    return null;
  }
  // A PAYG workspace in Account Debt is suspended: whatever the run tripped
  // on afterwards, the plug was already pulled. That includes an apply-time
  // quota error — the platform suspends by pinning the namespace under a
  // zero quota (`debt-limit0`), so "exceeded quota" there is a symptom of
  // the debt, not a quota to enlarge (ADR 0068). A subscribed workspace's
  // resources ride its plan, so its account's debt never rewrites anything.
  if (debtSuspendsWorkspace(standing) === true) {
    return {
      billingEvidence: {
        availableBalanceMicroUnits: standing.availableBalanceMicroUnits,
        checkedAt: input.now.toISOString(),
        kind: "account-debt",
      },
      reason: "balance-exhausted",
      // An apply-time denial the platform explained itself (the debt
      // webhook) keeps its text, like the provider's quota error does;
      // stall text still gives way to the headline.
      supersedesRunnerError: reason !== "balance-exhausted",
    };
  }
  // A payment-due Workspace Subscription suspends its workspace the same
  // way: whatever the run tripped on afterwards, the platform had already
  // pulled the plug — so the suspension outranks any not-elsewhere-proven
  // reason, quota errors included (ADR-0070).
  if (standing.paymentDue === true) {
    return {
      billingEvidence: {
        checkedAt: input.now.toISOString(),
        kind: "subscription-expired",
        recovery: standing.paymentDueRecovery ?? "renew",
      },
      reason: "subscription-expired",
      supersedesRunnerError: reason !== "subscription-expired",
    };
  }
  const full = standing.fullQuota;
  if (
    full == null ||
    !(reason === "quota-exceeded" || STALL_SHAPED.has(reason ?? "none"))
  ) {
    return null;
  }
  return {
    billingEvidence: {
      kind: "quota-full",
      label: full.label,
      percentUsed: full.percentUsed,
      type: full.type,
    },
    reason: "quota-exceeded",
    supersedesRunnerError: reason !== "quota-exceeded",
  };
}
