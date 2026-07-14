export type DeployTaskAbortReason =
  | "cancel-requested"
  | "shutdown"
  | "superseded";

/**
 * Cancellation is a typed outcome, never a failure (ADR 0038): runners catch
 * this (or observe the abort signal), stop side effects, report applied
 * evidence, and acknowledge — they never enter failure-cleanup paths.
 */
export class DeployTaskRunCancelledError extends Error {
  constructor(message = "Deployment task cancellation was requested.") {
    super(message);
    this.name = "DeployTaskRunCancelledError";
  }
}

/**
 * The execution lost its fence (stale lease epoch, terminal row, forced
 * resolution). The only correct reaction is to stop writing and exit.
 */
export class DeployTaskRunSupersededError extends Error {
  constructor(message = "Deployment task execution was superseded.") {
    super(message);
    this.name = "DeployTaskRunSupersededError";
  }
}

export function isDeployTaskAbortError(error: unknown): boolean {
  return (
    error instanceof DeployTaskRunCancelledError ||
    error instanceof DeployTaskRunSupersededError ||
    (error instanceof Error && error.name === "AbortError")
  );
}
