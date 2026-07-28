import { generateId } from "ai";
import { and, eq, inArray } from "drizzle-orm";

import { isCurrentDeploymentCredentialBinding } from "../credential-binding";
import { getDeployTaskRowInNamespace } from "../lookup";
import { publicDeployTaskBlockingInputs } from "../public-artifact-summary";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  type DeploymentTaskSource,
  type DeployTaskBlockingInput,
  type DeployTaskRow,
  deployTaskMessages,
  deployTasks,
} from "../schema";
import {
  isSensitiveDeploymentInput,
  MIN_SENSITIVE_INPUT_LENGTH,
  withoutSensitiveArgs,
} from "../sensitive-inputs";
import { DEPLOY_TASK_ACTIVE_STATUSES } from "../status-presentation";
import { createDeploymentTaskTimelineForRunner } from "../timeline";
import type {
  CreateDeployTaskInput,
  DeployTaskTargetResolution,
} from "../types";
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
  const displayName = compactOptional(input.target.displayName);
  return displayName == null
    ? `Deploy ${source} into a new Project`
    : `Deploy ${source} into new Project ${displayName}`;
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

export type SubmitDeployTaskInputRunLauncher = (
  handle: DeployTaskHandle,
  task: DeployTaskRow,
  currentBlockingInputs: readonly DeployTaskBlockingInput[],
  submittedValues: Record<string, string | number | boolean>
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
  | { kind: "predecessor-not-found" }
  | { displayName: string; kind: "project-name-conflict" };

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
    source: NonNullable<CreateDeployTaskInput["source"]>;
    target: NonNullable<CreateDeployTaskInput["target"]>;
  }) => Promise<DeployTaskTargetResolution>;
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
    predecessor = await getDeployTaskRowInNamespace(ctx.db, {
      namespace: input.create.namespace,
      taskId: input.predecessorTaskId,
    });
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
  const create: CreateDeployTaskInput = {
    createdFrom: input.create.createdFrom,
    creatingActor: input.create.creatingActor,
    credentialBinding: input.create.credentialBinding,
    namespace: input.create.namespace,
    prompt: input.create.prompt,
    runner,
    source,
    target,
  };
  const bindingError = invalidCredentialBinding(create);
  return bindingError == null
    ? { create, predecessor }
    : { kind: "invalid", message: bindingError };
}

function invalidCredentialBinding(
  create: CreateDeployTaskInput
): string | null {
  if (create.source.kind !== "github") {
    return create.credentialBinding == null
      ? null
      : "Only GitHub deployment tasks may carry a credential binding.";
  }
  const creatingActor = create.creatingActor?.trim() ?? "";
  const binding = create.credentialBinding;
  if (creatingActor === "" || binding == null) {
    return "GitHub deployment requires a verified creator and credential binding.";
  }
  if (
    !isCurrentDeploymentCredentialBinding(binding) ||
    binding.credentialOwner.trim() !== creatingActor
  ) {
    return "GitHub deployment credential binding is invalid.";
  }
  return null;
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
): Promise<DeployTaskTargetResolution | null> {
  const target = create.target;
  if (target.kind === "existingProject" && target.projectName?.trim()) {
    return {
      kind: "resolved",
      projectId: target.projectId,
      projectName: target.projectName.trim(),
    };
  }
  if (input.resolveTarget != null) {
    return await input.resolveTarget({
      namespace: create.namespace.trim(),
      source: create.source,
      target,
    });
  }
  return null;
}

function createdTaskEventPayload(
  task: DeployTaskRow,
  predecessor: DeployTaskRow | null
): Record<string, unknown> {
  return {
    ...(task.creatingActor == null ? {} : { actionActor: task.creatingActor }),
    ...(predecessor == null ? {} : { retriedFromTaskId: predecessor.id }),
    source: task.source,
    target: task.target,
  };
}

async function insertCreatedDeployTask(
  ctx: DeployTaskEngineContext,
  input: {
    create: CreateDeployTaskInput;
    predecessor: DeployTaskRow | null;
    resolvedProject: { projectId: string; projectName: string } | null;
  }
): Promise<
  DeployTaskRow | { kind: "clone-conflict"; activeClone: DeployTaskRow | null }
> {
  const { create, predecessor, resolvedProject } = input;
  const id = generateId();
  const now = new Date();
  const persistedSource = persistableDeploymentSource(create.source);
  const inheritedIdentities = cloneInheritedIdentities(create, predecessor);
  try {
    const [inserted] = await ctx.db
      .insert(deployTasks)
      .values({
        id,
        actorUserId: null,
        artifactSummary:
          inheritedIdentities == null
            ? {}
            : { resultIdentities: inheritedIdentities },
        createdAt: now,
        createdFrom: create.createdFrom ?? "api",
        creatingActor: create.creatingActor?.trim() || null,
        credentialBinding: create.credentialBinding ?? null,
        githubConnectionId: null,
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
        timelineSnapshot: createDeploymentTaskTimelineForRunner({
          runner: create.runner,
          source: persistedSource,
          status: "queued",
          taskId: id,
          updatedAt: now.toISOString(),
        }),
        updatedAt: now,
      })
      .returning();
    if (inserted == null) {
      throw new Error("Failed to create deploy task.");
    }
    return inserted;
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
            eq(deployTasks.namespace, create.namespace.trim()),
            inArray(deployTasks.status, [...DEPLOY_TASK_ACTIVE_STATUSES])
          )
        )
        .limit(1);
      return { kind: "clone-conflict", activeClone: activeClone ?? null };
    }
    throw error;
  }
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
  const resolution = await resolveCreateProject(input, create);
  if (resolution?.kind === "project-name-conflict") {
    return resolution;
  }

  const task = await insertCreatedDeployTask(ctx, {
    create,
    predecessor,
    resolvedProject: resolution,
  });
  if ("kind" in task) {
    return task;
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
      payload: createdTaskEventPayload(task, predecessor),
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
  namespace: string,
  from: "blocked" | "queued",
  actionActor?: string
): Promise<CancelDeployTaskActionResult | "retry"> {
  const transitioned = await transitionDeployTask(ctx, {
    event: {
      kind: "deployment_task.cancelled",
      message: "Deploy task cancelled before it ran.",
      payload: {
        ...(actionActor == null ? {} : { actionActor }),
        from,
      },
    },
    from: [from],
    taskId,
    to: "cancelled",
  });
  if (transitioned == null) {
    return "retry";
  }
  const cancelled = await getDeployTaskRowInNamespace(ctx.db, {
    namespace,
    taskId,
  });
  if (cancelled == null) {
    return { kind: "not-found" };
  }
  return { kind: "cancelled", task: cancelled };
}

/** Cooperative cancel for leased statuses: record intent, abort locally. */
async function requestLeasedTaskCancel(
  ctx: DeployTaskEngineContext,
  taskId: string,
  namespace: string,
  row: DeployTaskRow,
  actionActor?: string
): Promise<CancelDeployTaskActionResult | "retry"> {
  if (row.cancelRequestedAt == null) {
    const recorded = await recordDeployTaskCancelRequest(ctx, {
      actionActor,
      taskId,
    });
    if (recorded == null) {
      return "retry";
    }
  }
  abortLocalRunForCancel(taskId);
  const pending = await getDeployTaskRowInNamespace(ctx.db, {
    namespace,
    taskId,
  });
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
  input: { actionActor?: string; namespace: string; taskId: string }
): Promise<CancelDeployTaskActionResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await getDeployTaskRowInNamespace(ctx.db, input);
    if (row == null) {
      return { kind: "not-found" };
    }
    const settled = settledCancelResult(row);
    if (settled != null) {
      return settled;
    }
    const outcome =
      row.status === "queued" || row.status === "blocked"
        ? await cancelParkedTask(
            ctx,
            input.taskId,
            input.namespace,
            row.status,
            input.actionActor
          )
        : await requestLeasedTaskCancel(
            ctx,
            input.taskId,
            input.namespace,
            row,
            input.actionActor
          );
    if (outcome !== "retry") {
      return outcome;
    }
  }
  const finalRow = await getDeployTaskRowInNamespace(ctx.db, input);
  if (finalRow == null) {
    return { kind: "not-found" };
  }
  return (
    settledCancelResult(finalRow) ?? { kind: "cancelling", task: finalRow }
  );
}

export type SubmitDeployTaskInputActionResult =
  | { kind: "conflict"; task: DeployTaskRow }
  | { kind: "invalid-input"; message: string; task: DeployTaskRow }
  | { kind: "not-found" }
  | { kind: "resumed"; launched: LaunchedDeployTaskRun; task: DeployTaskRow };

export interface SubmitDeployTaskInputActionInput {
  actionActor?: string;
  namespace: string;
  /** Launches the resumed runner with the submitted values held in memory. */
  run: SubmitDeployTaskInputRunLauncher;
  taskId: string;
  values: Record<string, unknown>;
}

function isSubmittedScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function submittedInputValues(
  blockingInputs: DeployTaskBlockingInput[],
  values: Record<string, unknown>,
  options: { allowInternalIdFallback: boolean }
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    blockingInputs.flatMap((item) => {
      const canonicalKey = item.key ?? item.id;
      const candidates = options.allowInternalIdFallback
        ? new Set([canonicalKey, item.id])
        : [canonicalKey];
      for (const candidate of candidates) {
        const value = values[candidate];
        if (isSubmittedScalar(value)) {
          return [[canonicalKey, value]];
        }
      }
      return [];
    })
  );
}

function shortSensitiveSubmittedKey(
  blockingInputs: DeployTaskBlockingInput[],
  values: Record<string, string | number | boolean>
): string | null {
  for (const item of blockingInputs) {
    const key = item.key ?? item.id;
    const value = values[key];
    if (
      value !== undefined &&
      isSensitiveDeploymentInput({
        key,
        sensitive: item.sensitive,
        type: item.type,
      }) &&
      String(value).length > 0 &&
      String(value).length < MIN_SENSITIVE_INPUT_LENGTH
    ) {
      return key;
    }
  }
  return null;
}

function submittedEventInputKeys(input: {
  blockingInputs: DeployTaskBlockingInput[];
  submittedValues: Record<string, string | number | boolean>;
}): string[] {
  return input.blockingInputs.flatMap((item) =>
    Object.hasOwn(input.submittedValues, item.key ?? item.id)
      ? [item.key ?? item.id]
      : []
  );
}

function hasEveryRequiredBlockingInput(
  blockingInputs: DeployTaskBlockingInput[],
  submittedValues: Record<string, string | number | boolean>
): boolean {
  return blockingInputs.every((item) => {
    if (!item.required) {
      return true;
    }
    const value = submittedValues[item.key ?? item.id];
    return value !== undefined && String(value).trim() !== "";
  });
}

function hasUniqueCanonicalBlockingInputKeys(
  blockingInputs: DeployTaskBlockingInput[]
): boolean {
  const keys = blockingInputs.map((item) => item.key ?? item.id);
  return new Set(keys).size === keys.length;
}

/**
 * Blocking Input submission performs the blocked → running claim itself and
 * hands values to the runner in process memory; canonical key names may be
 * persisted, but submitted values never are (ADR 0037). The legacy
 * failed-at-configure resume path is gone: blocked is the only waiting state.
 */
export async function submitDeployTaskInputAction(
  ctx: DeployTaskEngineContext,
  input: SubmitDeployTaskInputActionInput
): Promise<SubmitDeployTaskInputActionResult> {
  const row = await getDeployTaskRowInNamespace(ctx.db, input);
  if (row == null) {
    return { kind: "not-found" };
  }
  if (row.status !== "blocked" || row.blockingInputs.length === 0) {
    return { kind: "conflict", task: row };
  }
  const currentBlockingInputs = [...row.blockingInputs];
  if (!hasUniqueCanonicalBlockingInputKeys(currentBlockingInputs)) {
    return {
      kind: "invalid-input",
      message: "Deployment inputs are unavailable. Redeploy to try again.",
      task: row,
    };
  }
  const publicBlockingInputs = publicDeployTaskBlockingInputs(
    currentBlockingInputs,
    {
      runner: row.runner,
      trustedMetadata:
        row.artifactSummary.publicProjectionVersion ===
        CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
    }
  );
  if (publicBlockingInputs.length !== currentBlockingInputs.length) {
    return {
      kind: "invalid-input",
      message: "Deployment inputs are unavailable. Redeploy to try again.",
      task: row,
    };
  }
  const submittedValues = submittedInputValues(
    currentBlockingInputs,
    input.values,
    { allowInternalIdFallback: row.runner.kind !== "ai" }
  );
  const submittedInputKeys = Object.keys(submittedValues);
  if (submittedInputKeys.length === 0) {
    return {
      kind: "invalid-input",
      message: "Submit at least one requested deployment input.",
      task: row,
    };
  }
  if (!hasEveryRequiredBlockingInput(currentBlockingInputs, submittedValues)) {
    return {
      kind: "invalid-input",
      message: "Submit every required deployment input.",
      task: row,
    };
  }
  const shortSensitiveKey = shortSensitiveSubmittedKey(
    currentBlockingInputs,
    submittedValues
  );
  if (shortSensitiveKey != null) {
    return {
      kind: "invalid-input",
      message:
        row.runner.kind === "ai"
          ? `Sensitive deployment inputs must be at least ${MIN_SENSITIVE_INPUT_LENGTH} characters.`
          : `Deployment input "${shortSensitiveKey}" must be at least ${MIN_SENSITIVE_INPUT_LENGTH} characters.`,
      task: row,
    };
  }
  const eventInputKeys = submittedEventInputKeys({
    blockingInputs: currentBlockingInputs,
    submittedValues,
  });

  await appendDeployTaskEvent(ctx, {
    event: {
      kind: "deploy_task.input_submitted",
      message: "Additional deploy input submitted.",
      payload: {
        ...(input.actionActor == null
          ? {}
          : { actionActor: input.actionActor }),
        inputKeys: eventInputKeys,
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
      payload:
        input.actionActor == null ? {} : { actionActor: input.actionActor },
      phase: "configure",
    },
    from: ["blocked"],
    lease: "claim",
    set: { blockingInputs: [], phase: "configure" },
    taskId: input.taskId,
    to: "running",
  });
  if (claim == null) {
    const current = await getDeployTaskRowInNamespace(ctx.db, input);
    if (current == null) {
      return { kind: "not-found" };
    }
    return { kind: "conflict", task: current };
  }

  const current = await getDeployTaskRowInNamespace(ctx.db, input);
  if (current == null) {
    return { kind: "not-found" };
  }
  const launched = launchDeployTaskRun(ctx, {
    claim,
    run: (handle) =>
      input.run(handle, current, currentBlockingInputs, submittedValues),
  });
  return { kind: "resumed", launched, task: current };
}
