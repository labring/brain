import {
  type DeploymentTaskProjection,
  deploymentTaskProjectionIsVisible,
} from "@/features/deploy/task/projection";

/**
 * Dock chip slot geometry (px). The chip floor mirrors the row's `min-w-32`
 * class (a chip narrower than this stops being readable, so it folds into
 * the overflow instead); the gap is one chip → divider → chip span
 * (gap-1 + 1px divider + gap-1); the reserve holds room for the widest
 * realistic "+N" trigger plus the divider before it.
 */
export const DEPLOYMENT_TASK_DOCK_CHIP_MIN_PX = 128;
export const DEPLOYMENT_TASK_DOCK_CHIP_GAP_PX = 9;
export const DEPLOYMENT_TASK_DOCK_OVERFLOW_RESERVE_PX = 84;

/**
 * How many chips (highest-priority first) fit the measured slot width.
 * Every task is shown only when each chip can take at least its floor width
 * with no overflow trigger; otherwise each visible chip must fit at its
 * floor alongside the "+N" reserve. Pure arithmetic so the fold decision
 * stays unit-testable — the DOM contributes only the measured width.
 */
export function fitDeploymentTaskDockChipCount(
  slotWidth: number,
  taskCount: number
): number {
  if (taskCount === 0) {
    return 0;
  }
  const allChipsWidth =
    taskCount * DEPLOYMENT_TASK_DOCK_CHIP_MIN_PX +
    (taskCount - 1) * DEPLOYMENT_TASK_DOCK_CHIP_GAP_PX;
  if (allChipsWidth <= slotWidth) {
    return taskCount;
  }
  let count = 0;
  while (
    count < taskCount &&
    (count + 1) *
      (DEPLOYMENT_TASK_DOCK_CHIP_MIN_PX + DEPLOYMENT_TASK_DOCK_CHIP_GAP_PX) +
      DEPLOYMENT_TASK_DOCK_OVERFLOW_RESERVE_PX <=
      slotWidth
  ) {
    count += 1;
  }
  return count;
}

export interface DeploymentTaskDockItem {
  active: boolean;
  task: DeploymentTaskProjection;
}

export interface DeploymentTaskDockModel {
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
  if (
    input.task.status === "failed" ||
    input.task.status === "completed" ||
    input.task.status === "cancelled"
  ) {
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
        dismissedTaskUpdatedAt: input.dismissedTaskUpdatedAtById.get(task.id),
        now,
        supersededTaskIds,
        task,
      })
        ? [{ active, task }]
        : [];
    })
  );

  return { tasks };
}
