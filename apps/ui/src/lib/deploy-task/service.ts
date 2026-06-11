import "server-only";

import type { UIMessage } from "ai";
import { generateId } from "ai";
import { and, asc, desc, eq, max, sql } from "drizzle-orm";

import { getAssistantDb } from "@/lib/chat-persistence/db";
import {
  type DeploymentTaskSource,
  type DeployTaskEventPayload,
  type DeployTaskEventRow,
  type DeployTaskMessageRow,
  type DeployTaskPhase,
  type DeployTaskRow,
  type DeployTaskStatus,
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "@/lib/chat-persistence/schema";

import type {
  CreateDeployTaskInput,
  DeployTaskDTO,
  DeployTaskEventDTO,
  DeployTaskEventInput,
  DeployTaskMessageDTO,
  DeployTaskSnapshotDTO,
  SubmitDeployTaskInput,
} from "./types";

const MAX_DEPLOY_EVENTS = 200;
const MAX_DEPLOY_MESSAGES = 200;

function compactOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function taskTitle(input: CreateDeployTaskInput): string {
  const source = deploymentSourceLabel(input.source);
  if (input.target.kind === "existingProject") {
    const project = compactOptional(
      input.target.projectName ?? input.target.projectId
    );
    return project ? `Deploy ${source} into ${project}` : `Deploy ${source}`;
  }
  return `Deploy ${source} into new Project ${input.target.displayName}`;
}

function deploymentSourceLabel(source: DeploymentTaskSource): string {
  switch (source.kind) {
    case "database":
      return "database";
    case "docker":
      return String(source.settings.image ?? "Docker image");
    case "github":
      return source.repo.fullName;
    case "prompt":
      return "AI prompt";
    case "template":
      return source.templateName;
    default:
      return source satisfies never;
  }
}

function nowIso(value: Date | null): string | null {
  return value == null ? null : value.toISOString();
}

export function toDeployTaskDTO(row: DeployTaskRow): DeployTaskDTO {
  return {
    artifactSummary: row.artifactSummary,
    blockingInputs: row.blockingInputs,
    completedAt: nowIso(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    error: row.error,
    gatewaySessionId: row.gatewaySessionId,
    gatewayTurnId: row.gatewayTurnId,
    gatewayUrl: row.gatewayUrl,
    id: row.id,
    namespace: row.namespace,
    phase: row.phase,
    previewUrl: row.previewUrl,
    projectId: row.projectId,
    projectName: row.projectName,
    resultUrl: row.resultUrl,
    runner: row.runner,
    runtimeName: row.runtimeName,
    runtimeProvider: row.runtimeProvider,
    runtimeState: row.runtimeState,
    source: row.source,
    startedAt: nowIso(row.startedAt),
    status: row.status,
    target: row.target,
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
    payload: row.payload,
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

export async function recordDeployTaskEvent(
  taskId: string,
  input: DeployTaskEventInput
): Promise<DeployTaskEventRow> {
  return await getAssistantDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${taskId}))`);

    const [row] = await tx
      .select({ value: max(deployTaskEvents.seq) })
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, taskId));
    const seq = (row?.value ?? 0) + 1;

    const [event] = await tx
      .insert(deployTaskEvents)
      .values({
        kind: input.kind,
        message: compactOptional(input.message),
        payload: input.payload ?? {},
        phase: input.phase ?? null,
        seq,
        taskId,
      })
      .returning();
    if (event == null) {
      throw new Error("Failed to record deploy task event.");
    }
    await tx
      .update(deployTasks)
      .set({
        heartbeatAt: new Date(),
        ...(input.phase == null ? {} : { phase: input.phase }),
        updatedAt: new Date(),
      })
      .where(eq(deployTasks.id, taskId));
    return event;
  });
}

export async function createDeployTask(
  input: CreateDeployTaskInput
): Promise<DeployTaskDTO> {
  const id = generateId();
  const now = new Date();
  const [task] = await getAssistantDb()
    .insert(deployTasks)
    .values({
      id,
      createdAt: now,
      heartbeatAt: now,
      namespace: input.namespace.trim(),
      phase: "queued",
      prompt: compactOptional(input.prompt) ?? taskTitle(input),
      runner: input.runner,
      source: input.source,
      status: "queued",
      target: input.target,
      updatedAt: now,
    })
    .returning();
  if (task == null) {
    throw new Error("Failed to create deploy task.");
  }

  await getAssistantDb()
    .insert(deployTaskMessages)
    .values({
      id: generateId(),
      parts: [
        {
          text: compactOptional(input.prompt) ?? taskTitle(input),
          type: "text",
        },
      ],
      role: "user",
      taskId: task.id,
    });

  await recordDeployTaskEvent(task.id, {
    kind: "deploy_task.created",
    message: "Deploy task queued.",
    payload: {
      source: task.source,
      target: task.target,
    },
    phase: "queued",
  });

  return toDeployTaskDTO(task);
}

export async function getDeployTaskById(
  taskId: string
): Promise<DeployTaskRow | null> {
  const [task] = await getAssistantDb()
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

  const [task] = await getAssistantDb()
    .select()
    .from(deployTasks)
    .where(and(...filters))
    .limit(1);
  if (task == null) {
    return null;
  }

  const [events, messages] = await Promise.all([
    getAssistantDb()
      .select()
      .from(deployTaskEvents)
      .where(eq(deployTaskEvents.taskId, taskId))
      .orderBy(desc(deployTaskEvents.seq))
      .limit(MAX_DEPLOY_EVENTS),
    getAssistantDb()
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

export async function listDeployTasks(input: {
  namespace: string;
  projectId?: string;
}): Promise<DeployTaskDTO[]> {
  const filters = [eq(deployTasks.namespace, input.namespace.trim())];
  if (input.projectId?.trim()) {
    filters.push(eq(deployTasks.projectId, input.projectId.trim()));
  }
  const rows = await getAssistantDb()
    .select()
    .from(deployTasks)
    .where(and(...filters))
    .orderBy(desc(deployTasks.updatedAt))
    .limit(100);
  return rows.map(toDeployTaskDTO);
}

export async function updateDeployTaskState(
  taskId: string,
  input: {
    artifactSummary?: DeployTaskRow["artifactSummary"];
    completedAt?: Date | null;
    error?: string | null;
    gatewaySessionId?: string | null;
    gatewayThreadId?: string | null;
    gatewayTurnId?: string | null;
    gatewayUrl?: string | null;
    phase?: DeployTaskPhase;
    previewUrl?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    resultUrl?: string | null;
    runtimeName?: string | null;
    runtimeProvider?: string | null;
    runtimeState?: string | null;
    startedAt?: Date | null;
    status?: DeployTaskStatus;
  }
): Promise<DeployTaskDTO | null> {
  const now = new Date();
  const isTerminal =
    input.status === "completed" ||
    input.status === "failed" ||
    input.status === "cancelled";
  const isActive =
    input.status === "queued" ||
    input.status === "running" ||
    input.status === "blocked" ||
    input.status === "applying";
  const [task] = await getAssistantDb()
    .update(deployTasks)
    .set({
      ...input,
      ...(input.status === "running" ? { startedAt: now } : {}),
      ...(isTerminal ? { completedAt: now } : {}),
      ...(isActive ? { completedAt: null } : {}),
      heartbeatAt: now,
      updatedAt: now,
    })
    .where(eq(deployTasks.id, taskId))
    .returning();
  return task == null ? null : toDeployTaskDTO(task);
}

export async function appendDeployTaskMessage(input: {
  id?: string;
  parts: UIMessage["parts"];
  role: UIMessage["role"];
  taskId: string;
}): Promise<DeployTaskMessageDTO> {
  const [message] = await getAssistantDb()
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

export async function submitDeployTaskInput(
  taskId: string,
  input: SubmitDeployTaskInput
): Promise<DeployTaskDTO | null> {
  await appendDeployTaskMessage({
    parts: [
      {
        text: JSON.stringify(input.values, null, 2),
        type: "text",
      },
    ],
    role: "user",
    taskId,
  });
  await recordDeployTaskEvent(taskId, {
    kind: "deploy_task.input_submitted",
    message: "Additional deploy input submitted.",
    payload: input.values as DeployTaskEventPayload,
    phase: "configure",
  });
  return await updateDeployTaskState(taskId, {
    phase: "configure",
    status: "queued",
  });
}

export async function cancelDeployTask(
  taskId: string
): Promise<DeployTaskDTO | null> {
  await recordDeployTaskEvent(taskId, {
    kind: "deploy_task.cancelled",
    message: "Deploy task cancelled.",
  });
  return await updateDeployTaskState(taskId, {
    status: "cancelled",
  });
}
