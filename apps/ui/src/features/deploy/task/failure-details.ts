import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "./failure-summary";
import type {
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
  return {
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
  if (input.runner.kind !== "ai") {
    const error = input.error?.trim();
    return error ? error : undefined;
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
