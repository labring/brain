import type { DeploymentTaskRunner, DeployTaskStatus } from "./schema";
import {
  createDeploymentTaskTimelineForRunner,
  type DeploymentTaskTimelineSnapshot,
} from "./timeline";

export interface DeploymentTaskTimelineTaskRecord {
  id: string;
  runner: DeploymentTaskRunner;
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
    return task.timelineSnapshot;
  }

  return createDeploymentTaskTimelineForRunner({
    runner: task.runner,
    status: task.status,
    taskId: task.id,
    updatedAt: isoDate(task.updatedAt),
  });
}
