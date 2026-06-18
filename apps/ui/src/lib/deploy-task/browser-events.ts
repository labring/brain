"use client";

export const DEPLOY_TASK_CREATED_EVENT = "sealai:deploy-task-created" as const;
const DEPLOY_TASK_CREATED_PENDING_KEY =
  "sealai:deploy-task-created:pending" as const;

export interface DeployTaskCreatedEventDetail {
  projectId: string;
  taskId: string;
}

export type DeployTaskCreatedEvent = CustomEvent<DeployTaskCreatedEventDetail>;

function readPendingDeployTaskCreatedEvents(): DeployTaskCreatedEventDetail[] {
  try {
    const raw = window.localStorage.getItem(DEPLOY_TASK_CREATED_PENDING_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is DeployTaskCreatedEventDetail =>
        item != null &&
        typeof item === "object" &&
        typeof (item as DeployTaskCreatedEventDetail).projectId === "string" &&
        typeof (item as DeployTaskCreatedEventDetail).taskId === "string"
    );
  } catch {
    return [];
  }
}

function writePendingDeployTaskCreatedEvents(
  events: readonly DeployTaskCreatedEventDetail[]
) {
  try {
    window.localStorage.setItem(
      DEPLOY_TASK_CREATED_PENDING_KEY,
      JSON.stringify(events)
    );
  } catch {
    // Best-effort bridge; the live browser event still fires.
  }
}

export function dispatchDeployTaskCreatedEvent(
  detail: DeployTaskCreatedEventDetail
) {
  const pending = readPendingDeployTaskCreatedEvents();
  if (!pending.some((item) => item.taskId === detail.taskId)) {
    writePendingDeployTaskCreatedEvents([...pending, detail]);
  }
  window.dispatchEvent(
    new CustomEvent(DEPLOY_TASK_CREATED_EVENT, {
      detail,
    })
  );
}

export function pendingDeployTaskCreatedEvents(): DeployTaskCreatedEventDetail[] {
  return readPendingDeployTaskCreatedEvents();
}

export function acknowledgePendingDeployTaskCreatedEvent(taskId: string) {
  writePendingDeployTaskCreatedEvents(
    readPendingDeployTaskCreatedEvents().filter(
      (item) => item.taskId !== taskId
    )
  );
}
