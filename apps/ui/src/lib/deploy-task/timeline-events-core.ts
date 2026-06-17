import type {
  DeploymentTaskTimelineSnapshotDTO,
  DeploymentTaskTimelineStreamEvent,
} from "./types";

type DeploymentTaskTimelineListener = (
  event: DeploymentTaskTimelineStreamEvent
) => void;

const listenersByTask = new Map<string, Set<DeploymentTaskTimelineListener>>();

export function subscribeDeploymentTaskTimelineEventsCore(input: {
  listener: DeploymentTaskTimelineListener;
  taskId: string;
}): () => void {
  const taskId = input.taskId.trim();
  let listeners = listenersByTask.get(taskId);
  if (listeners == null) {
    listeners = new Set();
    listenersByTask.set(taskId, listeners);
  }
  listeners.add(input.listener);

  return () => {
    listeners?.delete(input.listener);
    if (listeners?.size === 0) {
      listenersByTask.delete(taskId);
    }
  };
}

export function publishDeploymentTaskTimelineChangeCore(
  snapshot: DeploymentTaskTimelineSnapshotDTO
) {
  const listeners = listenersByTask.get(snapshot.task.id);
  if (listeners == null) {
    return;
  }

  const event: DeploymentTaskTimelineStreamEvent = {
    snapshot,
    type: "update",
  };
  for (const listener of [...listeners]) {
    listener(event);
  }
}
