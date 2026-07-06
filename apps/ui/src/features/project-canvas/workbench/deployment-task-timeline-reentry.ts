import {
  type DeploymentTaskProjection,
  deploymentTaskProjectionIsVisible,
} from "@/lib/deploy-task/projection";

export const DEPLOYMENT_TASK_DOCK_DESKTOP_LIMIT = 3;
export const DEPLOYMENT_TASK_DOCK_MOBILE_LIMIT = 1;
export const DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_MS = 6000;

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
  cancelled: 6,
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
  completedNoticeTaskIds: ReadonlySet<string>;
  dismissedTaskUpdatedAt: string | undefined;
  now: Date;
  supersededTaskIds: ReadonlySet<string>;
  task: DeploymentTaskProjection;
}): boolean {
  if (dockPriority(input.task) == null) {
    return false;
  }
  if (input.active) {
    return true;
  }
  // A redeploy dismisses its predecessor's reminder: supersession derives
  // from the successor's lineage (ADR 0038).
  if (input.supersededTaskIds.has(input.task.id)) {
    return false;
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
  // Cancelled is not attention-needed: a brief dismissible notice only
  // (ADR 0038), riding the same expiry machinery as completed.
  if (input.task.status === "completed" || input.task.status === "cancelled") {
    return input.completedNoticeTaskIds.has(input.task.id);
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
  completedNoticeTaskIds?: ReadonlySet<string>;
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
  now?: Date;
  tasks: readonly DeploymentTaskProjection[];
}): DeploymentTaskDockModel {
  const completedNoticeTaskIds = input.completedNoticeTaskIds ?? new Set();
  const now = input.now ?? new Date();
  const supersededTaskIds = new Set(
    input.tasks.flatMap((task) =>
      task.retriedFromTaskId == null ? [] : [task.retriedFromTaskId]
    )
  );
  const tasks = sortedDockItems(
    input.tasks.flatMap((task) => {
      const active = task.id === input.activeTaskId;
      return shouldIncludeDockTask({
        active,
        completedNoticeTaskIds,
        dismissedTaskUpdatedAt: input.dismissedTaskUpdatedAtById.get(task.id),
        now,
        supersededTaskIds,
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
