import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "./failure-summary";
import type {
  DeployBillingEvidence,
  DeploymentTaskRunner,
  DeployTaskFailureDetails,
  DeployTaskFailureReason,
  DeployTaskFailureStage,
  DeployTaskStatus,
} from "./schema";

const DEPLOY_FAILURE_DETAILS_KEY = "__sealaiDeployFailureDetails";

/**
 * Failure stage a deploy error is provably attributable to. `apply` means the
 * apply provider call itself threw — the only stage where this run may have
 * left partially created resources. `readiness` is the post-apply wait and
 * exists for diagnostics only.
 */
export type DeployFailureStage = DeployTaskFailureStage;

/**
 * Attaches structured failure context to an error so the run's single
 * terminal `fail` transition can persist it — intermediate writes of
 * failure_details on a live run are gone with the engine.
 */
export function attachDeployFailureDetails(
  error: unknown,
  details: DeployTaskFailureDetails
): unknown {
  if (error instanceof Error) {
    const carrier = error as Error & {
      [DEPLOY_FAILURE_DETAILS_KEY]?: DeployTaskFailureDetails;
    };
    carrier[DEPLOY_FAILURE_DETAILS_KEY] = {
      ...carrier[DEPLOY_FAILURE_DETAILS_KEY],
      ...details,
    };
  }
  return error;
}

export function attachedDeployFailureDetails(
  error: unknown
): DeployTaskFailureDetails {
  if (error instanceof Error) {
    const carrier = error as Error & {
      [DEPLOY_FAILURE_DETAILS_KEY]?: DeployTaskFailureDetails;
    };
    return carrier[DEPLOY_FAILURE_DETAILS_KEY] ?? {};
  }
  return {};
}

export function attachedDeployFailureReason(
  error: unknown
): DeployTaskFailureReason | null {
  const reason = attachedDeployFailureDetails(error).reason;
  return isDeployTaskFailureReason(reason) ? reason : null;
}

export function deployFailureError(reason: DeployTaskFailureReason): Error {
  const error = new Error(deploymentFailureMessage(reason));
  attachDeployFailureDetails(error, { reason });
  return error;
}

/** Validates persisted billing evidence before it reaches a public DTO. */
export function deployBillingEvidence(
  value: unknown
): DeployBillingEvidence | null {
  if (typeof value !== "object" || value == null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.kind === "account-debt" &&
    typeof record.checkedAt === "string" &&
    (record.availableBalanceMicroUnits === null ||
      typeof record.availableBalanceMicroUnits === "number")
  ) {
    return {
      availableBalanceMicroUnits: record.availableBalanceMicroUnits as
        | number
        | null,
      checkedAt: record.checkedAt,
      kind: "account-debt",
    };
  }
  if (
    record.kind === "quota-full" &&
    typeof record.label === "string" &&
    typeof record.percentUsed === "number" &&
    typeof record.type === "string"
  ) {
    return {
      kind: "quota-full",
      label: record.label,
      percentUsed: record.percentUsed,
      type: record.type,
    };
  }
  if (
    record.kind === "subscription-expired" &&
    typeof record.checkedAt === "string"
  ) {
    return {
      checkedAt: record.checkedAt,
      kind: "subscription-expired",
      ...(record.recovery === "renew" || record.recovery === "resubscribe"
        ? { recovery: record.recovery }
        : {}),
    };
  }
  if (
    record.kind === "subscription-paused" &&
    typeof record.checkedAt === "string"
  ) {
    return { checkedAt: record.checkedAt, kind: "subscription-paused" };
  }
  return null;
}

const MICRO_UNITS_PER_CURRENCY_UNIT = 1_000_000;

/** The billing check's lines for the Deployment Failure Detail (never raw upstream text). */
function billingEvidenceLines(evidence: DeployBillingEvidence): string[] {
  if (evidence.kind === "account-debt") {
    const available =
      evidence.availableBalanceMicroUnits == null
        ? "reported in debt by the platform"
        : `${evidence.availableBalanceMicroUnits / MICRO_UNITS_PER_CURRENCY_UNIT} <= 0`;
    return [
      `Billing check: available = balance - deductions + credits = ${available}`,
      `Checked at: ${evidence.checkedAt}`,
    ];
  }
  if (evidence.kind === "subscription-expired") {
    return [
      "Billing check: the workspace subscription is expired (payment-due), so the workspace is suspended",
      `Checked at: ${evidence.checkedAt}`,
    ];
  }
  if (evidence.kind === "subscription-paused") {
    return [
      "Billing check: the workspace subscription is paused (created with no trial), so the workspace is suspended",
      `Checked at: ${evidence.checkedAt}`,
    ];
  }
  return [`Quota: ${evidence.label} at ${evidence.percentUsed}%`];
}

export function publicDeployTaskFailureDetails(input: {
  details: DeployTaskFailureDetails | null;
  runner: DeploymentTaskRunner;
  status: DeployTaskStatus;
}): DeployTaskFailureDetails | null {
  if (input.runner.kind !== "ai") {
    return input.details;
  }

  const persistedReason = input.details?.reason;
  let reason: DeployTaskFailureReason | null = null;
  if (isDeployTaskFailureReason(persistedReason)) {
    reason = persistedReason;
  } else if (input.status === "failed") {
    reason = "unknown";
  }
  if (reason == null) {
    return null;
  }

  const httpStatus = input.details?.httpStatus;
  const stage = input.details?.stage;
  const billingEvidence = deployBillingEvidence(input.details?.billingEvidence);
  return {
    ...(billingEvidence == null ? {} : { billingEvidence }),
    failureMessage: deploymentFailureMessage(reason),
    ...(typeof httpStatus === "number" &&
    Number.isInteger(httpStatus) &&
    httpStatus >= 100 &&
    httpStatus <= 599
      ? { httpStatus }
      : {}),
    reason,
    ...(stage === "apply" || stage === "readiness" ? { stage } : {}),
  };
}

export function publicDeployTaskError(input: {
  details: DeployTaskFailureDetails | null;
  error: string | null;
  runner: DeploymentTaskRunner;
  status: DeployTaskStatus;
}): string | null {
  if (input.runner.kind !== "ai") {
    return input.error;
  }
  if (input.status !== "failed") {
    return null;
  }
  const details = publicDeployTaskFailureDetails(input);
  const reason = details?.reason;
  return isDeployTaskFailureReason(reason)
    ? deploymentFailureMessage(reason)
    : deploymentFailureMessage("unknown");
}

export function deploymentFailureTechnicalDetail(input: {
  details: DeployTaskFailureDetails | null;
  error: string | null;
  id: string;
  phase: string;
  runner: DeploymentTaskRunner;
  status: DeployTaskStatus;
}): string | undefined {
  if (input.status !== "failed") {
    return undefined;
  }
  const evidence = deployBillingEvidence(input.details?.billingEvidence);
  // A billing cause the runner never saw reached it only as a stall — a
  // timeout, a pod that never came up — and that text contradicts the
  // classification, so the billing check stands in for it on every runner
  // (design spec rows E1/E2, ADR 0068). An exhausted balance or an expired
  // subscription (ADR-0070) is always such a cause; a full quota is one
  // unless the apply step itself reported the quota error, the one stage
  // where the provider's own numbers are worth keeping.
  const billingReason = input.details?.reason;
  const billingSupersedesError =
    evidence != null &&
    (billingReason === "balance-exhausted" ||
      billingReason === "subscription-expired" ||
      billingReason === "subscription-paused" ||
      (billingReason === "quota-exceeded" && input.details?.stage !== "apply"));
  if (billingSupersedesError) {
    return [
      `Reason: ${billingReason}`,
      `Phase: ${input.phase}`,
      ...billingEvidenceLines(evidence),
      `Task ID: ${input.id}`,
    ].join("\n");
  }
  if (input.runner.kind !== "ai") {
    const error = input.error?.trim();
    if (!error) {
      return undefined;
    }
    return evidence == null
      ? error
      : [error, ...billingEvidenceLines(evidence)].join("\n");
  }

  const details = publicDeployTaskFailureDetails(input);
  const reason = details?.reason;
  const httpStatus = details?.httpStatus;
  if (!isDeployTaskFailureReason(reason)) {
    return undefined;
  }
  return [
    `Reason: ${reason}`,
    `Phase: ${input.phase}`,
    ...(typeof httpStatus === "number" ? [`HTTP status: ${httpStatus}`] : []),
    ...(evidence == null ? [] : billingEvidenceLines(evidence)),
    `Task ID: ${input.id}`,
  ].join("\n");
}

/**
 * Whether a failed template run may delete resources under its label
 * selector (ADR 0037/0038): only when the error is provably an apply-stage
 * partial creation AND the instance identity was freshly allocated by this
 * run — a reused identity means the selector also matches a previous run's
 * preserved resources, whose deletion must stay an explicit canvas action.
 * Any lost or absent marker degrades to preserving resources.
 */
export function templateCleanupAllowed(
  error: unknown,
  input: { identityFreshlyAllocated: boolean }
): boolean {
  return (
    input.identityFreshlyAllocated &&
    attachedDeployFailureDetails(error).stage === "apply"
  );
}
