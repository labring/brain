import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeployTaskStatus,
} from "./schema";
import {
  createDeploymentTaskTimelineForRunner,
  type DeploymentTaskTimelineSnapshot,
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
    // display status derives from the row on every read. The overlay must
    // stay a pure projection — bumping `revision` here would let a read
    // that lands between the runner's timeline write and its status
    // transition outrank every later read, wedging stream clients on the
    // stale intermediate state. `updatedAt` follows the row so snapshots
    // with equal revisions order by actual row write time.
    return {
      ...task.timelineSnapshot,
      status: task.status,
      updatedAt: isoDate(task.updatedAt),
    };
  }

  return createDeploymentTaskTimelineForRunner({
    runner: task.runner,
    source: task.source,
    status: task.status,
    taskId: task.id,
    updatedAt: isoDate(task.updatedAt),
  });
}
