import { publicDeployTaskArtifactSummary } from "./public-artifact-summary";
import type {
  DeploymentTaskCanvasProjection,
  DeploymentTaskCanvasProjectionResultMapping,
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
  "failed",
  "cancelled",
] as const satisfies readonly DeployTaskStatus[];

export type DeploymentTaskProjectionStatus =
  (typeof PROJECTABLE_DEPLOYMENT_TASK_STATUSES)[number];

const ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUS_SET = new Set<DeployTaskStatus>(
  ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUSES
);
const PROJECTABLE_DEPLOYMENT_TASK_STATUS_SET = new Set<DeployTaskStatus>(
  PROJECTABLE_DEPLOYMENT_TASK_STATUSES
);

export interface DeploymentTaskProjection {
  artifactSummary: DeployTaskArtifactSummary;
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: string | null;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  projectId: string;
  resultMappings?: DeploymentTaskCanvasProjectionResultMapping[];
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

export type DeploymentTaskProjectionStreamServerEvent =
  | DeploymentTaskProjectionStreamEvent
  | {
      message: string;
      type: "error";
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

function taskHasResultResources(
  task: Pick<DeploymentTaskProjectionSource, "artifactSummary">
): boolean {
  return (task.artifactSummary.resources?.length ?? 0) > 0;
}

function taskHasProjectionFacts(
  task: Pick<
    DeploymentTaskProjectionSource,
    "artifactSummary" | "canvasProjection"
  >
): boolean {
  return (
    taskHasResultResources(task) ||
    (task.artifactSummary.resourceYamls?.length ?? 0) > 0 ||
    (task.canvasProjection.slots?.length ?? 0) > 0 ||
    (task.canvasProjection.edges?.length ?? 0) > 0 ||
    (task.canvasProjection.resultMappings?.length ?? 0) > 0
  );
}

export function isDeploymentTaskProjectionStatus(
  status: DeployTaskStatus
): status is DeploymentTaskProjectionStatus {
  return PROJECTABLE_DEPLOYMENT_TASK_STATUS_SET.has(status);
}

export function deploymentTaskProjectionIsVisible(
  projection: DeploymentTaskProjection,
  now = new Date()
): boolean {
  if (ACTIVE_DEPLOYMENT_TASK_PROJECTION_STATUS_SET.has(projection.status)) {
    return true;
  }
  if (projection.status !== "completed") {
    return false;
  }
  const completedMs = dateMs(projection.completedAt);
  return (
    completedMs !== undefined &&
    taskHasProjectionFacts(projection) &&
    now.getTime() - completedMs <= DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS
  );
}

export function toDeploymentTaskProjection(
  task: DeploymentTaskProjectionSource,
  _now = new Date()
): DeploymentTaskProjection | null {
  const projectId = task.projectId?.trim();
  if (!projectId) {
    return null;
  }
  if (!isDeploymentTaskProjectionStatus(task.status)) {
    return null;
  }

  const completedAt = dateIso(task.completedAt);
  const artifactSummary = publicDeployTaskArtifactSummary(task.artifactSummary);
  const projection: DeploymentTaskProjection = {
    artifactSummary,
    canvasProjection: task.canvasProjection,
    completedAt,
    id: task.id,
    namespace: task.namespace,
    phase: task.phase,
    projectId,
    ...((task.canvasProjection.resultMappings?.length ?? 0) === 0
      ? {}
      : { resultMappings: task.canvasProjection.resultMappings }),
    status: task.status,
    updatedAt: dateIso(task.updatedAt) ?? new Date(0).toISOString(),
  };

  if (task.status === "completed" && !taskHasProjectionFacts(task)) {
    return null;
  }

  return projection;
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
