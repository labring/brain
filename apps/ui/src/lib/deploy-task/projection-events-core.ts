import {
  type DeploymentTaskProjectionStreamEvent,
  toDeploymentTaskProjection,
} from "./projection";
import type { DeployTaskDTO } from "./types";

type DeploymentTaskProjectionListener = (
  event: DeploymentTaskProjectionStreamEvent
) => void;

const listenersByProject = new Map<
  string,
  Set<DeploymentTaskProjectionListener>
>();

function projectKey(namespace: string, projectId: string) {
  return `${namespace}\0${projectId}`;
}

export function subscribeDeploymentTaskProjectionEventsCore(input: {
  listener: DeploymentTaskProjectionListener;
  namespace: string;
  projectId: string;
}): () => void {
  const key = projectKey(input.namespace, input.projectId);
  let listeners = listenersByProject.get(key);
  if (listeners == null) {
    listeners = new Set();
    listenersByProject.set(key, listeners);
  }
  listeners.add(input.listener);

  return () => {
    listeners?.delete(input.listener);
    if (listeners?.size === 0) {
      listenersByProject.delete(key);
    }
  };
}

function publishDeploymentTaskProjectionEventCore(
  event: DeploymentTaskProjectionStreamEvent
) {
  let key: string | null = null;
  if (event.type === "remove") {
    key = projectKey(event.namespace, event.projectId);
  }
  if (event.type === "upsert") {
    key = projectKey(event.projection.namespace, event.projection.projectId);
  }
  if (key == null) {
    return;
  }
  const listeners = listenersByProject.get(key);
  if (listeners == null) {
    return;
  }
  for (const listener of [...listeners]) {
    listener(event);
  }
}

export function publishDeploymentTaskProjectionChangeCore(task: DeployTaskDTO) {
  const projectId = task.projectId?.trim();
  if (!projectId) {
    return;
  }

  const projection = toDeploymentTaskProjection(task);
  if (projection == null) {
    publishDeploymentTaskProjectionEventCore({
      namespace: task.namespace,
      projectId,
      taskId: task.id,
      type: "remove",
    });
    return;
  }

  publishDeploymentTaskProjectionEventCore({
    projection,
    type: "upsert",
  });
}
