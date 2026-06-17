import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

function dateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

export function applyDeploymentTaskTimelineSnapshot(
  current: DeploymentTaskTimelineSnapshotDTO | null,
  incoming: DeploymentTaskTimelineSnapshotDTO
): DeploymentTaskTimelineSnapshotDTO {
  if (current == null || current.timeline.taskId !== incoming.timeline.taskId) {
    return incoming;
  }
  if (incoming.timeline.revision > current.timeline.revision) {
    return incoming;
  }
  if (incoming.timeline.revision < current.timeline.revision) {
    return current;
  }
  return dateMs(incoming.timeline.updatedAt) >=
    dateMs(current.timeline.updatedAt)
    ? incoming
    : current;
}
