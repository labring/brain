import { publicDeployTaskArtifactSummary } from "./public-artifact-summary";
import type {
  DeploymentTaskCanvasProjection,
  DeploymentTaskCanvasProjectionResultMapping,
  DeploymentTaskSource,
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

export interface DeploymentTaskDisplaySummary {
  resultSummary: string;
  sourceKind: DeploymentTaskSource["kind"];
  sourceSummary: string;
}

export interface DeploymentTaskProjection {
  artifactSummary: DeployTaskArtifactSummary;
  /** Server-derived "cancelling" truth (ADR 0038). */
  cancelRequestedAt?: string | null;
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: string | null;
  display?: DeploymentTaskDisplaySummary;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  projectId: string;
  resultMappings?: DeploymentTaskCanvasProjectionResultMapping[];
  /** Redeploy lineage: surfaces derive supersession from it (ADR 0038). */
  retriedFromTaskId?: string | null;
  status: DeploymentTaskProjectionStatus;
  updatedAt: string;
}

export interface SelectCanvasDeploymentTaskProjectionsInput {
  current?: readonly DeploymentTaskProjection[];
  now?: Date;
  projections: readonly DeploymentTaskProjection[];
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
  cancelRequestedAt?: Date | string | null;
  canvasProjection: DeploymentTaskCanvasProjection;
  completedAt: Date | string | null;
  id: string;
  namespace: string;
  phase: DeployTaskPhase;
  projectId: string | null;
  retriedFromTaskId?: string | null;
  source: DeploymentTaskSource;
  status: DeployTaskStatus;
  updatedAt: Date | string;
}

const MAX_SOURCE_SUMMARY_LENGTH = 48;
const MAX_RESULT_NAME_LENGTH = 28;
const RESULT_PENDING_SUMMARY = "Result pending";

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

function compactSummaryText(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? fallback : text;
}

function truncateSummary(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function deploymentTaskSourceSummary(
  source: DeploymentTaskSource
): string {
  switch (source.kind) {
    case "database":
      return `${compactSummaryText(
        source.settings.databaseId,
        "Database"
      )} database`;
    case "docker":
      return truncateSummary(
        compactSummaryText(source.settings.image, "Docker image"),
        MAX_SOURCE_SUMMARY_LENGTH
      );
    case "github":
      return truncateSummary(source.repo.fullName, MAX_SOURCE_SUMMARY_LENGTH);
    case "prompt":
      return truncateSummary(
        source.text ? `Prompt: ${source.text}` : "AI prompt",
        MAX_SOURCE_SUMMARY_LENGTH
      );
    case "template":
      return truncateSummary(source.templateName, MAX_SOURCE_SUMMARY_LENGTH);
    default:
      return source satisfies never;
  }
}

/**
 * A short, glanceable code derived from the task id — enough to tell two
 * same-source deployments apart in the pane header and dock chip, where the
 * source summary alone repeats. The full task id stays available in the
 * timeline's Task ID row for copying.
 */
export function deploymentTaskShortCode(taskId: string): string {
  return taskId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6);
}

function resultKindLabel(kind: string): string {
  switch (kind) {
    case "AP":
      return "AP";
    case "DB":
      return "DB";
    case "PublicAccess":
      return "Public access";
    default:
      return kind;
  }
}

function resultRefKey(ref: { kind: string; name: string; namespace: string }) {
  return `${ref.kind}\0${ref.namespace}\0${ref.name}`;
}

function compactResultRef(ref: { kind: string; name: string }): string {
  return `${resultKindLabel(ref.kind)} ${truncateSummary(
    ref.name,
    MAX_RESULT_NAME_LENGTH
  )}`;
}

function resultSummary(input: {
  artifactSummary: DeployTaskArtifactSummary;
  canvasProjection: DeploymentTaskCanvasProjection;
}): string {
  const refs: { kind: string; name: string; namespace: string }[] = [];
  const seen = new Set<string>();
  const addRef = (ref: { kind: string; name: string; namespace: string }) => {
    const name = ref.name.trim();
    const namespace = ref.namespace.trim();
    const kind = ref.kind.trim();
    if (!(kind && name && namespace)) {
      return;
    }
    const normalized = { kind, name, namespace };
    const key = resultRefKey(normalized);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(normalized);
  };

  for (const mapping of input.canvasProjection.resultMappings ?? []) {
    addRef(mapping.actualRef);
  }
  for (const slot of input.canvasProjection.slots ?? []) {
    if (slot.expectedRef != null) {
      addRef(slot.expectedRef);
    }
  }
  for (const resource of input.artifactSummary.resources ?? []) {
    addRef(resource);
  }

  if (refs.length === 0) {
    return RESULT_PENDING_SUMMARY;
  }

  const visible = refs.slice(0, 2).map(compactResultRef);
  const remaining = refs.length - visible.length;
  return remaining > 0
    ? `${visible.join(" + ")} +${remaining}`
    : visible.join(" + ");
}

function deploymentTaskDisplaySummary(
  task: Pick<
    DeploymentTaskProjectionSource,
    "artifactSummary" | "canvasProjection" | "source"
  >
): DeploymentTaskDisplaySummary {
  return {
    resultSummary: resultSummary({
      artifactSummary: task.artifactSummary,
      canvasProjection: task.canvasProjection,
    }),
    sourceKind: task.source.kind,
    sourceSummary: deploymentTaskSourceSummary(task.source),
  };
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

function deploymentTaskProjectionEqual(
  a: DeploymentTaskProjection,
  b: DeploymentTaskProjection
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deploymentTaskCanvasTopologyPayload(
  projection: DeploymentTaskProjection
) {
  return {
    artifactSummary: {
      resources: projection.artifactSummary.resources ?? [],
      resourceYamls: projection.artifactSummary.resourceYamls ?? [],
    },
    canvasProjection: {
      edges: projection.canvasProjection.edges ?? [],
      resultMappings: projection.canvasProjection.resultMappings ?? [],
      slots: projection.canvasProjection.slots ?? [],
    },
    id: projection.id,
    namespace: projection.namespace,
    projectId: projection.projectId,
    resultMappings: projection.resultMappings ?? [],
  };
}

export function deploymentTaskCanvasTopologySignature(
  projection: DeploymentTaskProjection,
  now = new Date()
): string | null {
  if (!deploymentTaskProjectionIsVisible(projection, now)) {
    return null;
  }
  return JSON.stringify(deploymentTaskCanvasTopologyPayload(projection));
}

function canvasTopologySignaturesByTaskId(
  projections: readonly DeploymentTaskProjection[],
  now: Date
): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const projection of projections) {
    const signature = deploymentTaskCanvasTopologySignature(projection, now);
    if (signature !== null) {
      signatures.set(projection.id, signature);
    }
  }
  return signatures;
}

export function deploymentTaskCanvasTopologyChanged(input: {
  current: readonly DeploymentTaskProjection[];
  next: readonly DeploymentTaskProjection[];
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const current = canvasTopologySignaturesByTaskId(input.current, now);
  const next = canvasTopologySignaturesByTaskId(input.next, now);
  if (current.size !== next.size) {
    return true;
  }
  for (const [taskId, signature] of next) {
    if (current.get(taskId) !== signature) {
      return true;
    }
  }
  return false;
}

export function selectCanvasDeploymentTaskProjections({
  current = [],
  now = new Date(),
  projections,
}: SelectCanvasDeploymentTaskProjectionsInput): DeploymentTaskProjection[] {
  const nextEntries = projections.flatMap((projection) => {
    const signature = deploymentTaskCanvasTopologySignature(projection, now);
    return signature === null ? [] : [{ projection, signature }];
  });
  const currentSignatures = canvasTopologySignaturesByTaskId(current, now);
  const unchanged =
    currentSignatures.size === nextEntries.length &&
    nextEntries.every(
      ({ projection, signature }) =>
        currentSignatures.get(projection.id) === signature
    );
  if (unchanged) {
    return current as DeploymentTaskProjection[];
  }

  const currentById = new Map(
    current.map((projection) => [projection.id, projection])
  );
  return nextEntries.map(({ projection, signature }) => {
    const existing = currentById.get(projection.id);
    return existing !== undefined &&
      deploymentTaskCanvasTopologySignature(existing, now) === signature
      ? existing
      : projection;
  });
}

export function nextDeploymentTaskProjectionVisibilityChangeMs(
  projections: readonly DeploymentTaskProjection[],
  now = new Date()
): number | undefined {
  const nowMs = now.getTime();
  let nextDelay: number | undefined;
  for (const projection of projections) {
    if (
      projection.status !== "completed" ||
      !taskHasProjectionFacts(projection)
    ) {
      continue;
    }
    const completedMs = dateMs(projection.completedAt);
    if (completedMs === undefined) {
      continue;
    }
    const delay =
      completedMs + DEPLOYMENT_TASK_PROJECTION_COMPLETED_GRACE_MS - nowMs;
    if (delay < 0) {
      continue;
    }
    nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
  }
  return nextDelay;
}

export function replaceDeploymentTaskProjections(
  current: DeploymentTaskProjection[],
  nextProjections: readonly DeploymentTaskProjection[]
): DeploymentTaskProjection[] {
  if (
    current.length === nextProjections.length &&
    current.every((projection, index) => {
      const next = nextProjections[index];
      return (
        next !== undefined && deploymentTaskProjectionEqual(projection, next)
      );
    })
  ) {
    return current;
  }
  return [...nextProjections];
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
    cancelRequestedAt: dateIso(task.cancelRequestedAt ?? null),
    canvasProjection: task.canvasProjection,
    completedAt,
    display: deploymentTaskDisplaySummary(task),
    id: task.id,
    namespace: task.namespace,
    phase: task.phase,
    projectId,
    retriedFromTaskId: task.retriedFromTaskId ?? null,
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
  projections: DeploymentTaskProjection[],
  projection: DeploymentTaskProjection
): DeploymentTaskProjection[] {
  const index = projections.findIndex((item) => item.id === projection.id);
  if (index === -1) {
    return [projection, ...projections];
  }
  const current = projections[index];
  if (
    current !== undefined &&
    deploymentTaskProjectionEqual(current, projection)
  ) {
    return projections;
  }
  const next = [...projections];
  next[index] = projection;
  return next;
}
