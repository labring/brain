import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeployTaskStatus,
} from "./schema";
import {
  createDeploymentTaskTimelineForRunner,
  type DeploymentTaskTimelineSnapshot,
  updateTimelineStatus,
} from "./timeline";

export interface DeploymentTaskTimelineTaskRecord {
  id: string;
  runner: DeploymentTaskRunner;
  source?: DeploymentTaskSource;
  status: DeployTaskStatus;
  timelineSnapshot: DeploymentTaskTimelineSnapshot | null;
  updatedAt: Date | string;
}

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

export function deploymentTaskTimelineFromTaskRecord(
  task: DeploymentTaskTimelineTaskRecord
): DeploymentTaskTimelineSnapshot {
  if (task.timelineSnapshot != null) {
    // The row's status column is the only source of truth (ADR 0037):
    // status transitions no longer rewrite the persisted snapshot, so the
    // display status derives from the row on every read.
    return updateTimelineStatus(task.timelineSnapshot, {
      status: task.status,
      updatedAt: isoDate(task.updatedAt),
    });
  }

  return createDeploymentTaskTimelineForRunner({
    runner: task.runner,
    source: task.source,
    status: task.status,
    taskId: task.id,
    updatedAt: isoDate(task.updatedAt),
  });
}
