import { generateId } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import type {
  DeploymentTaskSource,
  DeployTaskBlockingInput,
  DeployTaskRow,
} from "../schema";
import { deployTaskMessages, deployTasks } from "../schema";
import { withoutSensitiveArgs } from "../sensitive-inputs";
import { DEPLOY_TASK_ACTIVE_STATUSES } from "../status-presentation";
import { createDeploymentTaskTimelineForRunner } from "../timeline";
import type { CreateDeployTaskInput } from "../types";
import type { DeployTaskEngineContext } from "./context";
import type { DeployTaskHandle } from "./handle";
import {
  abortLocalRunForCancel,
  type LaunchedDeployTaskRun,
  launchDeployTaskRun,
} from "./runtime";
import {
  appendDeployTaskEvent,
  isDeployTaskTerminalStatus,
  recordDeployTaskCancelRequest,
  transitionDeployTask,
} from "./transitions";

function compactOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Row-level secrets contract (ADR 0037): template source args are stripped
 * of client-declared sensitive keys and name-heuristic matches before any
 * persisted form is built. The credentialed request hands the full values
 * to the launched runner in process memory; the persisted `sensitiveKeys`
 * records every stripped key name — never a value — so a clone knows
 * exactly what must be re-asked (US15).
 */
function persistableDeploymentSource(
  source: DeploymentTaskSource
): DeploymentTaskSource {
  if (source.kind !== "template" || source.args == null) {
    return source;
  }
  const declared = (source.sensitiveKeys ?? []).map((key) => ({
    key,
    sensitive: true,
  }));
  const args = withoutSensitiveArgs(source.args, declared);
  const sensitiveKeys = [
    ...new Set([
      ...(source.sensitiveKeys ?? []),
      ...Object.keys(source.args).filter((key) => !(key in args)),
    ]),
  ].sort();
  return {
    ...source,
    args,
    ...(sensitiveKeys.length === 0 ? {} : { sensitiveKeys }),
  };
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

async function readTaskRow(
  ctx: DeployTaskEngineContext,
  taskId: string
): Promise<DeployTaskRow | null> {
  const [row] = await ctx.db
    .select()
    .from(deployTasks)
    .where(eq(deployTasks.id, taskId))
    .limit(1);
  return row ?? null;
}

function isUniqueViolation(error: unknown, indexName: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current != null; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (
        record.code === "23505" ||
        (typeof record.message === "string" &&
          record.message.includes(indexName))
      ) {
        return true;
      }
      current = record.cause;
      continue;
    }
    break;
  }
  return false;
}

export type DeployTaskRunLauncher = (
  handle: DeployTaskHandle,
  task: DeployTaskRow
) => Promise<void>;

export type CreateDeployTaskActionResult =
  | { kind: "clone-conflict"; activeClone: DeployTaskRow | null }
  | {
      kind: "created";
      launched: LaunchedDeployTaskRun | null;
      task: DeployTaskRow;
    }
  | { kind: "invalid"; message: string }
  | { kind: "predecessor-conflict"; predecessor: DeployTaskRow }
  | { kind: "predecessor-not-found" };

export type CreateDeployTaskActionCreateInput = Omit<
  CreateDeployTaskInput,
  "runner" | "source" | "target"
> &
  Partial<Pick<CreateDeployTaskInput, "runner" | "source" | "target">>;

export interface CreateDeployTaskActionInput {
  create: CreateDeployTaskActionCreateInput;
  predecessorTaskId?: string;
  /**
   * Resolves (or creates) the target Project before insert so the stored row
   * and the creation response carry the Project identity from the start.
   * Omitted in tests; a clone with a cached predecessor Project skips it.
   */
  resolveTarget?: (input: {
    namespace: string;
    target: NonNullable<CreateDeployTaskInput["target"]>;
  }) => Promise<{ projectId: string; projectName: string }>;
  /** Launches the runner under the inline-claimed lease. */
  run: DeployTaskRunLauncher;
}

/**
 * Task creation, also serving redeploy clones (ADR 0038): validates the
 * predecessor, records lineage, copies recorded result identities, inserts
 * `queued`, claims the lease inline, and launches the runner in-process —
 * the credentialed request is the execution attachment (ADR 0037).
 */
interface ResolvedCreateInputs {
  create: CreateDeployTaskInput;
  predecessor: DeployTaskRow | null;
}

function cloneTargetFromPredecessor(
  predecessor: DeployTaskRow
): CreateDeployTaskInput["target"] {
  // A predecessor with a resolved Project always converges on that same
  // Project — even when it originally targeted a new one (ADR 0038).
  const predecessorProjectId = predecessor.projectId?.trim();
  if (predecessorProjectId) {
    return {
      kind: "existingProject" as const,
      projectId: predecessorProjectId,
      projectName: predecessor.projectName ?? undefined,
    };
  }
  return predecessor.target;
}

async function resolveCreateInputs(
  ctx: DeployTaskEngineContext,
  input: CreateDeployTaskActionInput
): Promise<CreateDeployTaskActionResult | ResolvedCreateInputs> {
  let predecessor: DeployTaskRow | null = null;
  if (input.predecessorTaskId != null) {
    predecessor = await readTaskRow(ctx, input.predecessorTaskId);
    if (predecessor == null) {
      return { kind: "predecessor-not-found" };
    }
    if (predecessor.status !== "failed" && predecessor.status !== "cancelled") {
      return { kind: "predecessor-conflict", predecessor };
    }
  }

  // A clone inherits whatever the redeploy did not edit.
  const source = input.create.source ?? predecessor?.source;
  const runner = input.create.runner ?? predecessor?.runner;
  const target =
    input.create.target ??
    (predecessor == null ? undefined : cloneTargetFromPredecessor(predecessor));
  if (source == null || runner == null || target == null) {
    return {
      kind: "invalid",
      message: "Deploy task creation requires source, runner, and target.",
    };
  }
  return {
    create: {
      actorUserId:
        input.create.actorUserId ?? predecessor?.actorUserId ?? undefined,
      createdFrom: input.create.createdFrom,
      githubConnectionId:
        input.create.githubConnectionId ??
        predecessor?.githubConnectionId ??
        undefined,
      namespace: input.create.namespace,
      prompt: input.create.prompt,
      runner,
      source,
      target,
    },
    predecessor,
  };
}

/**
 * Result identities converge a clone onto the predecessor's preserved
 * resources (ADR 0038) — meaningful only when the clone lands on the same
 * Project. An edited redeploy that retargets gets fresh identities instead
 * of dragging a namespace-scoped instance name somewhere it never existed.
 */
function cloneInheritedIdentities(
  create: CreateDeployTaskInput,
  predecessor: DeployTaskRow | null
): DeployTaskRow["artifactSummary"]["resultIdentities"] | undefined {
  const identities = predecessor?.artifactSummary.resultIdentities;
  if (predecessor == null || identities == null) {
    return undefined;
  }
  const predecessorProjectId = predecessor.projectId?.trim();
  if (create.target.kind === "existingProject") {
    // Prefer the resolved Project on the row; fall back to the predecessor's
    // declared target for rows created before resolution succeeded.
    const matches = predecessorProjectId
      ? create.target.projectId === predecessorProjectId
      : predecessor.target.kind === "existingProject" &&
        create.target.projectId === predecessor.target.projectId;
    return matches ? identities : undefined;
  }
  if (predecessor.target.kind === "newProject" && !predecessorProjectId) {
    // Verbatim clone of a predecessor that never resolved its new Project.
    return create.target.displayName === predecessor.target.displayName
      ? identities
      : undefined;
  }
  return undefined;
}

async function resolveCreateProject(
  input: CreateDeployTaskActionInput,
  create: CreateDeployTaskInput
): Promise<{ projectId: string; projectName: string } | null> {
  const target = create.target;
  if (target.kind === "existingProject" && target.projectName?.trim()) {
    return {
      projectId: target.projectId,
      projectName: target.projectName.trim(),
    };
  }
  if (input.resolveTarget != null) {
    return await input.resolveTarget({
      namespace: create.namespace.trim(),
      target,
    });
  }
  return null;
}

export async function createDeployTaskAction(
  ctx: DeployTaskEngineContext,
  input: CreateDeployTaskActionInput
): Promise<CreateDeployTaskActionResult> {
  const resolved = await resolveCreateInputs(ctx, input);
  if ("kind" in resolved) {
    return resolved;
  }
  const { create, predecessor } = resolved;
  const resolvedProject = await resolveCreateProject(input, create);

  const id = generateId();
  const now = new Date();
  const persistedSource = persistableDeploymentSource(create.source);
  const timelineSnapshot = createDeploymentTaskTimelineForRunner({
    runner: create.runner,
    source: persistedSource,
    status: "queued",
    taskId: id,
    updatedAt: now.toISOString(),
  });

  const inheritedIdentities = cloneInheritedIdentities(create, predecessor);
  let task: DeployTaskRow;
  try {
    const [inserted] = await ctx.db
      .insert(deployTasks)
      .values({
        id,
        actorUserId: create.actorUserId?.trim() || null,
        artifactSummary:
          inheritedIdentities == null
            ? {}
            : { resultIdentities: inheritedIdentities },
        createdAt: now,
        createdFrom: create.createdFrom ?? "api",
        githubConnectionId: create.githubConnectionId?.trim() || null,
        namespace: create.namespace.trim(),
        phase: "queued",
        projectId: resolvedProject?.projectId ?? null,
        projectName: resolvedProject?.projectName ?? null,
        prompt: compactOptional(create.prompt) ?? taskTitle(create),
        retriedFromTaskId: predecessor?.id ?? null,
        runner: create.runner,
        source: persistedSource,
        status: "queued",
        target: create.target,
        timelineSnapshot,
        updatedAt: now,
      })
      .returning();
    if (inserted == null) {
      throw new Error("Failed to create deploy task.");
    }
    task = inserted;
  } catch (error) {
    if (
      predecessor != null &&
      isUniqueViolation(error, "deploy_tasks_one_active_clone_idx")
    ) {
      const [activeClone] = await ctx.db
        .select()
        .from(deployTasks)
        .where(
          and(
            eq(deployTasks.retriedFromTaskId, predecessor.id),
            inArray(deployTasks.status, [...DEPLOY_TASK_ACTIVE_STATUSES])
          )
        )
        .limit(1);
      return { kind: "clone-conflict", activeClone: activeClone ?? null };
    }
    throw error;
  }

  await ctx.db.insert(deployTaskMessages).values({
    id: generateId(),
    parts: [{ text: task.prompt ?? taskTitle(create), type: "text" }],
    role: "user",
    taskId: task.id,
  });
  await appendDeployTaskEvent(ctx, {
    event: {
      kind: "deploy_task.created",
      message: "Deploy task queued.",
      payload: {
        source: task.source,
        target: task.target,
        ...(predecessor == null ? {} : { retriedFromTaskId: predecessor.id }),
      },
      phase: "queued",
    },
    from: ["queued"],
    taskId: task.id,
  });

  const claim = await transitionDeployTask(ctx, {
    event: {
      kind: "deployment_task.started",
      message: "Deployment run started.",
      payload: {},
      phase: "prepare",
    },
    from: ["queued"],
    lease: "claim",
    set: { phase: "prepare" },
    taskId: task.id,
    to: "running",
  });

  const current = await readTaskRow(ctx, task.id);
  if (claim == null || current == null) {
    // A concurrent cancel (or a crash-resolved verdict) won the row between
    // insert and claim; report the stored state truthfully.
    return { kind: "created", launched: null, task: current ?? task };
  }

  const launched = launchDeployTaskRun(ctx, {
    claim,
    run: (handle) => input.run(handle, current),
  });
  return { kind: "created", launched, task: current };
}

export type CancelDeployTaskActionResult =
  | { kind: "already-terminal"; task: DeployTaskRow }
  | { kind: "cancelled"; task: DeployTaskRow }
  | { kind: "cancelling"; task: DeployTaskRow }
  | { kind: "not-found" };

/**
 * Two-phase cancel under one idempotency rule (ADR 0038): parked statuses
 * cancel immediately, leased statuses record the intent (cooperative ack),
 * a repeat is success, and a terminal task is a conflict with the snapshot.
 */
/** Immediate cancel for parked statuses (queued/blocked; ADR 0038). */
async function cancelParkedTask(
  ctx: DeployTaskEngineContext,
  taskId: string,
  from: "blocked" | "queued"
): Promise<CancelDeployTaskActionResult | "retry"> {
  const transitioned = await transitionDeployTask(ctx, {
    event: {
      kind: "deployment_task.cancelled",
      message: "Deploy task cancelled before it ran.",
      payload: { from },
    },
    from: [from],
    taskId,
    to: "cancelled",
  });
  if (transitioned == null) {
    return "retry";
  }
  const cancelled = await readTaskRow(ctx, taskId);
  if (cancelled == null) {
    return { kind: "not-found" };
  }
  return { kind: "cancelled", task: cancelled };
}

/** Cooperative cancel for leased statuses: record intent, abort locally. */
async function requestLeasedTaskCancel(
  ctx: DeployTaskEngineContext,
  taskId: string,
  row: DeployTaskRow
): Promise<CancelDeployTaskActionResult | "retry"> {
  if (row.cancelRequestedAt == null) {
    const recorded = await recordDeployTaskCancelRequest(ctx, { taskId });
    if (recorded == null) {
      return "retry";
    }
  }
  abortLocalRunForCancel(taskId);
  const pending = await readTaskRow(ctx, taskId);
  if (pending == null) {
    return { kind: "not-found" };
  }
  if (pending.status === "cancelled") {
    return { kind: "cancelled", task: pending };
  }
  return { kind: "cancelling", task: pending };
}

function settledCancelResult(
  row: DeployTaskRow
): CancelDeployTaskActionResult | null {
  if (row.status === "cancelled") {
    return { kind: "cancelled", task: row };
  }
  if (isDeployTaskTerminalStatus(row.status)) {
    return { kind: "already-terminal", task: row };
  }
  return null;
}

export async function cancelDeployTaskAction(
  ctx: DeployTaskEngineContext,
  input: { taskId: string }
): Promise<CancelDeployTaskActionResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await readTaskRow(ctx, input.taskId);
    if (row == null) {
      return { kind: "not-found" };
    }
    const settled = settledCancelResult(row);
    if (settled != null) {
      return settled;
    }
    const outcome =
      row.status === "queued" || row.status === "blocked"
        ? await cancelParkedTask(ctx, input.taskId, row.status)
        : await requestLeasedTaskCancel(ctx, input.taskId, row);
    if (outcome !== "retry") {
      return outcome;
    }
  }
  const finalRow = await readTaskRow(ctx, input.taskId);
  if (finalRow == null) {
    return { kind: "not-found" };
  }
  return (
    settledCancelResult(finalRow) ?? { kind: "cancelling", task: finalRow }
  );
}

export type SubmitDeployTaskInputActionResult =
  | { kind: "conflict"; task: DeployTaskRow }
  | { kind: "not-found" }
  | { kind: "resumed"; launched: LaunchedDeployTaskRun; task: DeployTaskRow };

export interface SubmitDeployTaskInputActionInput {
  /** Launches the resumed runner with the submitted values held in memory. */
  run: DeployTaskRunLauncher;
  taskId: string;
  values: Record<string, unknown>;
}

function submittedKeyNames(
  blockingInputs: DeployTaskBlockingInput[],
  values: Record<string, unknown>
): string[] {
  const known = new Set(
    blockingInputs.flatMap((item) => [item.id, item.key ?? item.id])
  );
  return Object.keys(values).filter(
    (key) => known.has(key) || known.size === 0
  );
}

/**
 * Blocking Input submission performs the blocked → running claim itself and
 * hands values to the runner in process memory; only redacted key names are
 * ever persisted (ADR 0037). The legacy failed-at-configure resume path is
 * gone: blocked is the only waiting state.
 */
export async function submitDeployTaskInputAction(
  ctx: DeployTaskEngineContext,
  input: SubmitDeployTaskInputActionInput
): Promise<SubmitDeployTaskInputActionResult> {
  const row = await readTaskRow(ctx, input.taskId);
  if (row == null) {
    return { kind: "not-found" };
  }
  if (row.status !== "blocked" || row.blockingInputs.length === 0) {
    return { kind: "conflict", task: row };
  }

  await appendDeployTaskEvent(ctx, {
    event: {
      kind: "deploy_task.input_submitted",
      message: "Additional deploy input submitted.",
      payload: {
        inputKeys: submittedKeyNames(row.blockingInputs, input.values),
        redacted: true,
      },
      phase: "configure",
    },
    from: ["blocked"],
    taskId: input.taskId,
  });

  const claim = await transitionDeployTask(ctx, {
    event: {
      kind: "deployment_task.resumed",
      message: "Deployment run resumed with submitted input.",
      payload: {},
      phase: "configure",
    },
    from: ["blocked"],
    lease: "claim",
    set: { blockingInputs: [], phase: "configure" },
    taskId: input.taskId,
    to: "running",
  });
  if (claim == null) {
    const current = await readTaskRow(ctx, input.taskId);
    if (current == null) {
      return { kind: "not-found" };
    }
    return { kind: "conflict", task: current };
  }

  const current = await readTaskRow(ctx, input.taskId);
  if (current == null) {
    return { kind: "not-found" };
  }
  const launched = launchDeployTaskRun(ctx, {
    claim,
    run: (handle) => input.run(handle, current),
  });
  return { kind: "resumed", launched, task: current };
}
