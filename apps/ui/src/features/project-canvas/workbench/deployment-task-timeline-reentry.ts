import {
  type DeploymentTaskProjection,
  deploymentTaskProjectionIsVisible,
} from "@/lib/deploy-task/projection";

export const DEPLOYMENT_TASK_DOCK_DESKTOP_LIMIT = 3;
export const DEPLOYMENT_TASK_DOCK_MOBILE_LIMIT = 1;

export interface DeploymentTaskDockItem {
  active: boolean;
  task: DeploymentTaskProjection;
}

export interface DeploymentTaskDockModel {
  desktopHiddenCount: number;
  desktopTasks: DeploymentTaskDockItem[];
  mobileHiddenCount: number;
  mobileTasks: DeploymentTaskDockItem[];
  tasks: DeploymentTaskDockItem[];
}

const DEPLOYMENT_TASK_DOCK_STATUS_PRIORITY = {
  blocked: 0,
  failed: 1,
  applying: 2,
  running: 3,
  queued: 4,
  completed: 5,
  cancelled: null,
} as const satisfies Record<DeploymentTaskProjection["status"], number | null>;

function taskUpdatedAtMs(task: DeploymentTaskProjection): number {
  const ms = Date.parse(task.updatedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function dockPriority(task: DeploymentTaskProjection): number | null {
  return DEPLOYMENT_TASK_DOCK_STATUS_PRIORITY[task.status];
}

function taskDismissedAtCurrentVersion(input: {
  dismissedTaskUpdatedAt: string | undefined;
  task: DeploymentTaskProjection;
}): boolean {
  return input.dismissedTaskUpdatedAt === input.task.updatedAt;
}

function shouldIncludeDockTask(input: {
  active: boolean;
  dismissedTaskUpdatedAt: string | undefined;
  now: Date;
  task: DeploymentTaskProjection;
}): boolean {
  if (dockPriority(input.task) == null) {
    return false;
  }
  if (input.active) {
    return true;
  }
  if (
    taskDismissedAtCurrentVersion({
      dismissedTaskUpdatedAt: input.dismissedTaskUpdatedAt,
      task: input.task,
    })
  ) {
    return false;
  }
  if (input.task.status === "failed") {
    return true;
  }
  return deploymentTaskProjectionIsVisible(input.task, input.now);
}

function sortedDockItems(
  items: readonly DeploymentTaskDockItem[]
): DeploymentTaskDockItem[] {
  return [...items].sort((a, b) => {
    const priorityA = dockPriority(a.task) ?? Number.POSITIVE_INFINITY;
    const priorityB = dockPriority(b.task) ?? Number.POSITIVE_INFINITY;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return taskUpdatedAtMs(b.task) - taskUpdatedAtMs(a.task);
  });
}

export function selectDeploymentTaskDock(input: {
  activeTaskId: string | null;
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
  now?: Date;
  tasks: readonly DeploymentTaskProjection[];
}): DeploymentTaskDockModel {
  const now = input.now ?? new Date();
  const tasks = sortedDockItems(
    input.tasks.flatMap((task) => {
      const active = task.id === input.activeTaskId;
      return shouldIncludeDockTask({
        active,
        dismissedTaskUpdatedAt: input.dismissedTaskUpdatedAtById.get(task.id),
        now,
        task,
      })
        ? [{ active, task }]
        : [];
    })
  );

  const desktopTasks = tasks.slice(0, DEPLOYMENT_TASK_DOCK_DESKTOP_LIMIT);
  const mobileTasks = tasks.slice(0, DEPLOYMENT_TASK_DOCK_MOBILE_LIMIT);

  return {
    desktopHiddenCount: Math.max(
      0,
      tasks.length - DEPLOYMENT_TASK_DOCK_DESKTOP_LIMIT
    ),
    desktopTasks,
    mobileHiddenCount: Math.max(
      0,
      tasks.length - DEPLOYMENT_TASK_DOCK_MOBILE_LIMIT
    ),
    mobileTasks,
    tasks,
  };
}
