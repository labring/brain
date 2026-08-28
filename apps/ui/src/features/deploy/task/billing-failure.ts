import type { WorkspaceBillingStanding } from "@/features/billing/server/billing-standing-core";

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

export function resolveBillingFailureOverride(input: {
  now: Date;
  reason: DeployTaskFailureReason | null;
  standing: WorkspaceBillingStanding;
}): BillingFailureOverride | null {
  const { reason, standing } = input;
  if (reason != null && PROVEN_ELSEWHERE.has(reason)) {
    return null;
  }
  // A workspace in Account Debt is suspended: whatever the run tripped on
  // afterwards, the plug was already pulled.
  if (standing.accountDebt === true) {
    return {
      billingEvidence: {
        availableBalanceMicroUnits: standing.availableBalanceMicroUnits,
        checkedAt: input.now.toISOString(),
        kind: "account-debt",
      },
      reason: "balance-exhausted",
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
  };
}
