import "server-only";

import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { getDeploymentTaskDb } from "./db";
import { getDeployTaskEngineContext } from "./engine/server";
import { publishDeployTaskChange } from "./engine/transitions";
import {
  type DeploymentTaskProjection,
  PROJECTABLE_DEPLOYMENT_TASK_STATUSES,
  toDeploymentTaskProjection,
} from "./projection";
import {
  publicDeployTaskArtifactSummary,
  publicDeployTaskEventPayload,
} from "./public-artifact-summary";
import {
  type DeployTaskEventRow,
  type DeployTaskMessageRow,
  type DeployTaskRow,
  type DeployTaskStatus,
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "./schema";
import { deploymentTaskTimelineFromTaskRecord } from "./timeline-storage";

import type {
  DeploymentTaskCanvasProjection,
  DeploymentTaskTimelineSnapshotDTO,
  DeployTaskDTO,
  DeployTaskEventDTO,
  DeployTaskMessageDTO,
  DeployTaskSnapshotDTO,
  UpdateDeployTaskCanvasProjectionInput,
} from "./types";

const MAX_DEPLOY_EVENTS = 200;
const MAX_DEPLOY_MESSAGES = 200;
const DEFAULT_TASK_LIST_LIMIT = 100;

function nowIso(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

export function toDeployTaskDTO(row: DeployTaskRow): DeployTaskDTO {
  return {
    actorUserId: row.actorUserId,
    artifactSummary: publicDeployTaskArtifactSummary(row.artifactSummary),
    blockingInputs: row.blockingInputs,
    cancelRequestedAt: nowIso(row.cancelRequestedAt),
    canvasProjection: row.canvasProjection,
    completedAt: nowIso(row.completedAt),
    createdFrom: row.createdFrom,
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    failureDetails: row.failureDetails,
    gatewaySessionId: row.gatewaySessionId,
    gatewayStateSnapshot: row.gatewayStateSnapshot,
    gatewayTurnId: row.gatewayTurnId,
    gatewayUrl: row.gatewayUrl,
    githubConnectionId: row.githubConnectionId,
    id: row.id,
    namespace: row.namespace,
    phase: row.phase,
    previewUrl: row.previewUrl,
    projectId: row.projectId,
    projectName: row.projectName,
    resultUrl: row.resultUrl,
    retriedFromTaskId: row.retriedFromTaskId,
    runner: row.runner,
    runtimeName: row.runtimeName,
    runtimeProvider: row.runtimeProvider,
    runtimeState: row.runtimeState,
    source: row.source,
    startedAt: nowIso(row.startedAt),
    status: row.status,
    target: row.target,
    timelineSnapshot: row.timelineSnapshot,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDeployTaskEventDTO(
  row: DeployTaskEventRow
): DeployTaskEventDTO {
  return {
    createdAt: row.createdAt.toISOString(),
    kind: row.kind,
    message: row.message,
    payload: publicDeployTaskEventPayload(row.payload),
    phase: row.phase,
    seq: row.seq,
    taskId: row.taskId,
  };
}

export function toDeployTaskMessageDTO(
  row: DeployTaskMessageRow
): DeployTaskMessageDTO {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    parts: row.parts,
    role: row.role,
    taskId: row.taskId,
  };
}

export async function getDeployTaskById(
  taskId: string
): Promise<DeployTaskRow | null> {
  const [task] = await getDeploymentTaskDb()
    .select()
    .from(deployTasks)
    .where(eq(deployTasks.id, taskId))
    .limit(1);
  return task ?? null;
}

export async function getDeployTaskSnapshot(
  taskId: string,
  namespace?: string
): Promise<DeployTaskSnapshotDTO | null> {
  const filters = [eq(deployTasks.id, taskId)];
  if (namespace?.trim()) {
    filters.push(eq(deployTasks.namespace, namespace.trim()));
  }

  const [task] = await getDeploymentTaskDb()
    .select()
    .from(deployTasks)
    .where(and(...filters))
    .limit(1);
  if (task == null) {
    return null;
  }

  const [events, messages] = await Promise.all([
    getDeploymentTaskDb()
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, taskId))
      .orderBy(desc(deployTaskEvents.seq))
      .limit(MAX_DEPLOY_EVENTS),
    getDeploymentTaskDb()
      .select()
      .from(deployTaskMessages)
      .where(eq(deployTaskMessages.taskId, taskId))
      .orderBy(asc(deployTaskMessages.createdAt), asc(deployTaskMessages.id))
      .limit(MAX_DEPLOY_MESSAGES),
  ]);

  return {
    events: events.reverse().map(toDeployTaskEventDTO),
    messages: messages.map(toDeployTaskMessageDTO),
    task: toDeployTaskDTO(task),
  };
}

async function recentDeployTaskEvents(
  taskId: string
): Promise<DeployTaskEventDTO[]> {
  const events = await getDeploymentTaskDb()
    .select()
    .from(deployTaskEvents)
    .where(eq(deployTaskEvents.taskId, taskId))
    .orderBy(desc(deployTaskEvents.seq))
    .limit(MAX_DEPLOY_EVENTS);
  return events.reverse().map(toDeployTaskEventDTO);
}

/**
 * Pure read (ADR 0037): the prior readiness reconciliation — completing
 * `applying` tasks from the read path with an unfenced write — is gone.
 * Reads never write status; the runner owns verification under its lease.
 */
export async function getDeployTaskTimelineSnapshot(
  taskId: string,
  namespace?: string
): Promise<DeploymentTaskTimelineSnapshotDTO | null> {
  const filters = [eq(deployTasks.id, taskId)];
  if (namespace?.trim()) {
    filters.push(eq(deployTasks.namespace, namespace.trim()));
  }

  const [task] = await getDeploymentTaskDb()
    .select()
    .from(deployTasks)
    .where(and(...filters))
    .limit(1);
  if (task == null) {
    return null;
  }

  return {
    events: await recentDeployTaskEvents(taskId),
    task: toDeployTaskDTO(task),
    timeline: deploymentTaskTimelineFromTaskRecord(task),
  };
}

export interface ListDeployTasksInput {
  /** Opaque cursor from a previous page (createdAt/id keyset). */
  cursor?: string;
  limit?: number;
  namespace: string;
  projectId?: string;
  status?: DeployTaskStatus[];
}

export interface ListDeployTasksResult {
  nextCursor: string | null;
  tasks: DeployTaskDTO[];
}

function encodeTaskCursor(row: DeployTaskRow): string {
  return Buffer.from(
    JSON.stringify({ c: row.createdAt.toISOString(), i: row.id })
  ).toString("base64url");
}

function decodeTaskCursor(
  cursor: string | undefined
): { createdAt: Date; id: string } | null {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as { c?: string; i?: string };
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string") {
      return null;
    }
    const createdAt = new Date(parsed.c);
    if (Number.isNaN(createdAt.getTime())) {
      return null;
    }
    return { createdAt, id: parsed.i };
  } catch {
    return null;
  }
}

/**
 * Cursor pagination keys on (createdAt, id) — stable under updates, unlike
 * updatedAt — so any future task surface pages the same API (ADR 0037).
 */
export async function listDeployTasks(
  input: ListDeployTasksInput
): Promise<ListDeployTasksResult> {
  const limit = Math.min(
    Math.max(input.limit ?? DEFAULT_TASK_LIST_LIMIT, 1),
    200
  );
  const filters = [eq(deployTasks.namespace, input.namespace.trim())];
  if (input.projectId?.trim()) {
    filters.push(eq(deployTasks.projectId, input.projectId.trim()));
  }
  if (input.status != null && input.status.length > 0) {
    filters.push(inArray(deployTasks.status, input.status));
  }
  const cursor = decodeTaskCursor(input.cursor);
  if (cursor != null) {
    const beforeCursor = or(
      lt(deployTasks.createdAt, cursor.createdAt),
      and(
        eq(deployTasks.createdAt, cursor.createdAt),
        lt(deployTasks.id, cursor.id)
      )
    );
    if (beforeCursor != null) {
      filters.push(beforeCursor);
    }
  }

  const rows = await getDeploymentTaskDb()
    .select()
    .from(deployTasks)
    .where(and(...filters))
    .orderBy(desc(deployTasks.createdAt), desc(deployTasks.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const lastRow = page.at(-1);
  return {
    nextCursor:
      rows.length > limit && lastRow != null ? encodeTaskCursor(lastRow) : null,
    tasks: page.map(toDeployTaskDTO),
  };
}

export async function listDeploymentTaskProjections(input: {
  namespace: string;
  projectId: string;
}): Promise<DeploymentTaskProjection[]> {
  const rows = await getDeploymentTaskDb()
    .select()
    .from(deployTasks)
    .where(
      and(
        eq(deployTasks.namespace, input.namespace.trim()),
        eq(deployTasks.projectId, input.projectId.trim()),
        inArray(deployTasks.status, [...PROJECTABLE_DEPLOYMENT_TASK_STATUSES])
      )
    )
    .orderBy(desc(deployTasks.updatedAt))
    .limit(100);
  return rows.flatMap((row) => {
    const projection = toDeploymentTaskProjection(row);
    return projection == null ? [] : [projection];
  });
}

function shouldSkipSetIfEmptyCanvasProjection(input: {
  existing: DeploymentTaskCanvasProjection;
  incoming: DeploymentTaskCanvasProjection;
}): boolean {
  const incomingHasSlots = (input.incoming.slots?.length ?? 0) > 0;
  if (incomingHasSlots) {
    return (input.existing.slots?.length ?? 0) > 0;
  }
  return (
    (input.existing.slots?.length ?? 0) > 0 ||
    (input.existing.edges?.length ?? 0) > 0 ||
    (input.existing.resultMappings?.length ?? 0) > 0
  );
}

/**
 * Canvas projection is user canvas state on the task row, not engine state:
 * a plain conditional write (single statement) that publishes a change so
 * every process's streams converge.
 */
export async function updateDeployTaskCanvasProjection(
  taskId: string,
  input: UpdateDeployTaskCanvasProjectionInput
): Promise<DeployTaskDTO | null> {
  const existing = await getDeployTaskById(taskId);
  if (existing == null) {
    return null;
  }
  const mode = input.mode ?? "replace";
  if (
    mode === "set-if-empty" &&
    shouldSkipSetIfEmptyCanvasProjection({
      existing: existing.canvasProjection,
      incoming: input.projection,
    })
  ) {
    return toDeployTaskDTO(existing);
  }
  const guard =
    mode === "set-if-empty"
      ? sql`${deployTasks.canvasProjection} = ${JSON.stringify(existing.canvasProjection)}::jsonb`
      : undefined;
  const [task] = await getDeploymentTaskDb()
    .update(deployTasks)
    .set({
      canvasProjection: input.projection,
      updatedAt: new Date(),
    })
    .where(
      guard == null
        ? eq(deployTasks.id, taskId)
        : and(eq(deployTasks.id, taskId), guard)
    )
    .returning();
  if (task == null) {
    return existing == null ? null : toDeployTaskDTO(existing);
  }
  const dto = toDeployTaskDTO(task);
  await publishDeployTaskChange(getDeployTaskEngineContext(), {
    namespace: dto.namespace,
    projectId: dto.projectId,
    taskId: dto.id,
  });
  return dto;
}

export async function appendDeployTaskMessage(input: {
  id?: string;
  parts: UIMessage["parts"];
  role: UIMessage["role"];
  taskId: string;
}): Promise<DeployTaskMessageDTO> {
  const [message] = await getDeploymentTaskDb()
    .insert(deployTaskMessages)
    .values({
      id: input.id ?? generateId(),
      parts: input.parts,
      role: input.role,
      taskId: input.taskId,
    })
    .onConflictDoUpdate({
      target: deployTaskMessages.id,
      set: {
        parts: input.parts,
        role: input.role,
      },
    })
    .returning();
  if (message == null) {
    throw new Error("Failed to append deploy task message.");
  }
  return toDeployTaskMessageDTO(message);
}
