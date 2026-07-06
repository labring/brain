import type { DeployTaskStatus } from "./schema";

/**
 * The one status-to-presentation mapping for deployment tasks (PRD #162):
 * dock chips, the timeline pane, and canvas affordances all read from here
 * instead of keeping their own switches.
 */
export type DeployTaskStatusHue =
  | "blue"
  | "green"
  | "neutral"
  | "red"
  | "yellow";

export function deployTaskStatusLabel(status: DeployTaskStatus): string {
  switch (status) {
    case "applying":
      return "applying";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
      return "queued";
    case "running":
      return "running";
    default:
      return status satisfies never;
  }
}

export function deployTaskStatusHue(
  status: DeployTaskStatus
): DeployTaskStatusHue {
  switch (status) {
    case "applying":
    case "running":
      return "blue";
    case "blocked":
      return "yellow";
    case "cancelled":
    case "queued":
      return "neutral";
    case "completed":
      return "green";
    case "failed":
      return "red";
    default:
      return status satisfies never;
  }
}

export function deployTaskStatusDotClass(status: DeployTaskStatus): string {
  switch (deployTaskStatusHue(status)) {
    case "blue":
      return "bg-blue-300";
    case "green":
      return "bg-emerald-300";
    case "neutral":
      return status === "cancelled" ? "bg-zinc-500" : "bg-zinc-300";
    case "red":
      return "bg-red-300";
    case "yellow":
      return "bg-amber-300";
    default:
      return "bg-zinc-300";
  }
}

export const DEPLOY_TASK_ACTIVE_STATUSES = [
  "queued",
  "running",
  "blocked",
  "applying",
] as const satisfies readonly DeployTaskStatus[];

/** Cancel applies to every active status (two-phase past claim, ADR 0038). */
export function deployTaskIsCancellable(status: DeployTaskStatus): boolean {
  return (DEPLOY_TASK_ACTIVE_STATUSES as readonly DeployTaskStatus[]).includes(
    status
  );
}

/** Redeploy is the only recovery from failed or cancelled (ADR 0038). */
export function deployTaskIsRedeployable(status: DeployTaskStatus): boolean {
  return status === "failed" || status === "cancelled";
}

/**
 * "Cancelling" is server-derived truth: an active task with a recorded
 * cancel request (optimistic client state only bridges the round-trip).
 */
export function deployTaskIsCancelling(task: {
  cancelRequestedAt?: string | null;
  status: DeployTaskStatus;
}): boolean {
  return task.cancelRequestedAt != null && deployTaskIsCancellable(task.status);
}
