import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";

export interface DeploymentTaskTimelineReentry {
  label: string;
  task: DeploymentTaskProjection;
}

const REENTRY_LABEL_BY_STATUS = {
  applying: "Deployment applying",
  blocked: "Deployment blocked",
  failed: "Deployment failed",
  queued: "Deployment queued",
  running: "Deployment running",
} as const satisfies Partial<
  Record<DeploymentTaskProjection["status"], string>
>;

function taskUpdatedAtMs(task: DeploymentTaskProjection): number {
  const ms = Date.parse(task.updatedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function reentryLabel(
  task: DeploymentTaskProjection
): DeploymentTaskTimelineReentry["label"] | null {
  return REENTRY_LABEL_BY_STATUS[task.status] ?? null;
}

export function selectDeploymentTaskTimelineReentry(input: {
  activeTaskId: string | null;
  dismissedTaskIds: ReadonlySet<string>;
  tasks: readonly DeploymentTaskProjection[];
}): DeploymentTaskTimelineReentry | null {
  let selected: DeploymentTaskTimelineReentry | null = null;
  let selectedUpdatedAt = Number.NEGATIVE_INFINITY;

  for (const task of input.tasks) {
    if (task.id === input.activeTaskId || input.dismissedTaskIds.has(task.id)) {
      continue;
    }
    const label = reentryLabel(task);
    if (label == null) {
      continue;
    }

    const updatedAt = taskUpdatedAtMs(task);
    if (selected == null || updatedAt > selectedUpdatedAt) {
      selected = { label, task };
      selectedUpdatedAt = updatedAt;
    }
  }

  return selected;
}
