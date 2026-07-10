const DEPLOY_FAILURE_DETAILS_KEY = "__sealaiDeployFailureDetails";

/**
 * Failure stage a deploy error is provably attributable to. `apply` means the
 * apply provider call itself threw — the only stage where this run may have
 * left partially created resources. `readiness` is the post-apply wait and
 * exists for diagnostics only.
 */
export type DeployFailureStage = "apply" | "readiness";

/**
 * Attaches structured failure context to an error so the run's single
 * terminal `fail` transition can persist it — intermediate writes of
 * failure_details on a live run are gone with the engine.
 */
export function attachDeployFailureDetails(
  error: unknown,
  details: Record<string, unknown> & { stage?: DeployFailureStage }
): unknown {
  if (error instanceof Error) {
    const carrier = error as Error & {
      [DEPLOY_FAILURE_DETAILS_KEY]?: Record<string, unknown>;
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
): Record<string, unknown> {
  if (error instanceof Error) {
    const carrier = error as Error & {
      [DEPLOY_FAILURE_DETAILS_KEY]?: Record<string, unknown>;
    };
    return carrier[DEPLOY_FAILURE_DETAILS_KEY] ?? {};
  }
  return {};
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
