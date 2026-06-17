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
  const candidates = input.tasks
    .flatMap((task) => {
      if (
        task.id === input.activeTaskId ||
        input.dismissedTaskIds.has(task.id)
      ) {
        return [];
      }
      const label = reentryLabel(task);
      return label == null ? [] : [{ label, task }];
    })
    .sort((a, b) => taskUpdatedAtMs(b.task) - taskUpdatedAtMs(a.task));

  return candidates[0] ?? null;
}
