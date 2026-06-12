import type {
  DeploymentTaskCanvasProjection,
  DeployTaskArtifactSummary,
  DeployTaskPhase,
  DeployTaskStatus,
} from "./types";

export const DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS = 60_000;

export const ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUSES = [
  "queued",
  "running",
  "blocked",
  "applying",
] as const satisfies readonly DeployTaskStatus[];

export const PROJECTABLE_DEPLOYMENT_TASK_STATUSES = [
  ...ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUSES,
  "completed",
] as const satisfies readonly DeployTaskStatus[];

export type DeploymentTaskProjectionStatus =
  (typeof PROJECTABLE_DEPLOYMENT_TASK_STATUSES)[number];

export interface DeploymentTaskProjection {
  artifactSummary: DeployTaskArtifactSummary;
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: string | null;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  projectId: string;
  status: DeploymentTaskProjectionStatus;
  updatedAt: string;
}

export type DeploymentTaskProjectionStreamEvent =
  | {
      projections: DeploymentTaskProjection[];
      type: "snapshot";
    }
  | {
      projection: DeploymentTaskProjection;
      type: "upsert";
    }
  | {
      namespace: string;
      projectId: string;
      taskId: string;
      type: "remove";
    };

interface DeploymentTaskProjectionSource {
  artifactSummary: DeployTaskArtifactSummary;
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: Date | string | null;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  projectId: string | null;
  status: DeployTaskStatus;
  updatedAt: Date | string;
}

function dateIso(value: Date | string | null): string | null {
  if (value == null) {
    return null;
  }
  return typeof value === "string" ? value : value.toISOString();
}

function dateMs(value: Date | string | null): number | undefined {
  if (value == null) {
    return undefined;
  }
  const ms = typeof value === "string" ? Date.parse(value) : value.getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function taskHasResultResources(task: DeploymentTaskProjectionSource): boolean {
  return (task.artifactSummary.resources?.length ?? 0) > 0;
}

export function deploymentTaskProjectionIsVisible(
  projection: DeploymentTaskProjection,
  now = new Date()
): boolean {
  if (
    ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUSES.includes(
      projection.status as (typeof ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUSES)[number]
    )
  ) {
    return true;
  }
  if (projection.status !== "completed") {
    return false;
  }
  const completedMs = dateMs(projection.completedAt);
  return (
    completedMs !== undefined &&
    (projection.artifactSummary.resources?.length ?? 0) > 0 &&
    now.getTime() - completedMs <= DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS
  );
}

export function toDeploymentTaskProjection(
  task: DeploymentTaskProjectionSource,
  now = new Date()
): DeploymentTaskProjection | null {
  const projectId = task.projectId?.trim();
  if (!projectId) {
    return null;
  }

  const completedAt = dateIso(task.completedAt);
  const projection: DeploymentTaskProjection = {
    artifactSummary: task.artifactSummary,
    canvasProjection: task.canvasProjection,
    completedAt,
    id: task.id,
    namespace: task.namespace,
    phase: task.phase,
    projectId,
    status: task.status as DeploymentTaskProjectionStatus,
    updatedAt: dateIso(task.updatedAt) ?? new Date(0).toISOString(),
  };

  if (task.status === "completed" && !taskHasResultResources(task)) {
    return null;
  }

  return deploymentTaskProjectionIsVisible(projection, now) ? projection : null;
}

export function upsertDeploymentTaskProjection(
  projections: readonly DeploymentTaskProjection[],
  projection: DeploymentTaskProjection
): DeploymentTaskProjection[] {
  const index = projections.findIndex((item) => item.id === projection.id);
  if (index === -1) {
    return [projection, ...projections];
  }
  const next = [...projections];
  next[index] = projection;
  return next;
}
