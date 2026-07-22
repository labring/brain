import { type SQL, sql } from "drizzle-orm";

import type {
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskFailureDetails,
  DeployTaskPhase,
  DeployTaskStatus,
} from "../schema";
import type { DeployTaskEngineContext } from "./context";
import {
  type DeployTaskRowLite,
  EVENTS,
  intervalFromMs,
  jsonbParam,
  liteOf,
  RETURNING_LITE,
  rowsOf,
  statusListSql,
  TASKS,
} from "./sql";

// The one active-status taxonomy lives in the client-safe presentation
// module (client surfaces must not import engine code): engine callers
// import DEPLOY_TASK_ACTIVE_STATUSES from ../status-presentation directly.
export type { DeployTaskRowLite } from "./sql";

export const DEPLOY_TASK_LEASED_STATUSES = [
  "running",
  "applying",
] as const satisfies readonly DeployTaskStatus[];

export const DEPLOY_TASK_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "cancelled",
] as const satisfies readonly DeployTaskStatus[];

/**
 * The transition table (ADR 0037). Anything absent is rejected before SQL is
 * built; the conditional update then enforces it against the live row.
 */
const DEPLOY_TASK_TRANSITIONS: Record<
  DeployTaskStatus,
  readonly DeployTaskStatus[]
> = {
  applying: ["completed", "failed", "cancelled"],
  blocked: ["running", "cancelled"],
  cancelled: [],
  completed: [],
  failed: [],
  queued: ["running", "cancelled", "failed"],
  running: ["blocked", "applying", "failed", "cancelled"],
};

export function isDeployTaskTerminalStatus(status: DeployTaskStatus): boolean {
  return (DEPLOY_TASK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface DeployTaskTransitionEvent {
  kind: string;
  message?: string;
  payload?: Record<string, unknown>;
  phase?: DeployTaskPhase;
}

export interface DeployTaskTransitionSet {
  artifactSummary?: DeployTaskArtifactSummary;
  blockingInputs?: DeployTaskBlockingInput[];
  error?: string | null;
  failureDetails?: DeployTaskFailureDetails | null;
  phase?: DeployTaskPhase;
}

export interface DeployTaskTransitionInput {
  event?: DeployTaskTransitionEvent;
  /** Fence: reject unless the row still carries this lease epoch. */
  expectedLeaseEpoch?: number;
  from: readonly DeployTaskStatus[];
  /** "claim" bumps the epoch and grants a lease; terminal states release. */
  lease?: "claim";
  set?: DeployTaskTransitionSet;
  taskId: string;
  to: DeployTaskStatus;
}

function eventInsertCte(event: DeployTaskTransitionEvent): SQL {
  return sql`, recorded_event AS (
    INSERT INTO ${EVENTS} ("task_id", "kind", "message", "phase", "payload")
    SELECT changed."id", ${event.kind}, ${event.message ?? null}, ${event.phase ?? null}, ${jsonbParam(event.payload ?? {})}
    FROM changed
  )`;
}

/** Publish a task change, never failing the write that caused it. */
export async function publishDeployTaskChange(
  ctx: DeployTaskEngineContext,
  row: { namespace: string; projectId: string | null; taskId: string }
): Promise<void> {
  try {
    await ctx.notify.publish({
      kind: "change",
      namespace: row.namespace,
      projectId: row.projectId,
      taskId: row.taskId,
    });
  } catch (error) {
    console.error("[deploy-task-engine] notify publish failed:", error);
  }
}

async function runLiteStatement(
  ctx: DeployTaskEngineContext,
  statement: SQL,
  options: { notify: boolean }
): Promise<DeployTaskRowLite | null> {
  const result = await ctx.db.execute(statement);
  const [record] = rowsOf(result);
  if (record == null) {
    return null;
  }
  const row = liteOf(record);
  if (options.notify) {
    await publishDeployTaskChange(ctx, row);
  }
  return row;
}

/**
 * The only status write path (ADR 0037): one conditional UPDATE carrying the
 * allowed source statuses and (when fenced) the expected lease epoch, with
 * the transition's event recorded in the same statement. Returns null when
 * the guard loses; callers re-read and obey.
 */
function transitionSets(
  ctx: DeployTaskEngineContext,
  input: DeployTaskTransitionInput
): Map<string, SQL> {
  const sets = new Map<string, SQL>();
  sets.set("status", sql`"status" = ${input.to}`);
  sets.set("updated_at", sql`"updated_at" = now()`);

  const isTerminal = isDeployTaskTerminalStatus(input.to);
  if (isTerminal) {
    sets.set("completed_at", sql`"completed_at" = now()`);
    sets.set("lease_owner", sql`"lease_owner" = NULL`);
    sets.set("lease_expires_at", sql`"lease_expires_at" = NULL`);
  } else {
    sets.set("completed_at", sql`"completed_at" = NULL`);
  }
  if (input.to === "completed" || !isTerminal) {
    sets.set("error", sql`"error" = NULL`);
    sets.set("failure_details", sql`"failure_details" = NULL`);
  }
  if (input.to === "blocked") {
    sets.set("lease_owner", sql`"lease_owner" = NULL`);
    sets.set("lease_expires_at", sql`"lease_expires_at" = NULL`);
  }
  if (input.lease === "claim") {
    if (input.to !== "running") {
      throw new Error("A lease claim must transition to running.");
    }
    sets.set("lease_owner", sql`"lease_owner" = ${ctx.processId}`);
    sets.set("lease_epoch", sql`"lease_epoch" = "lease_epoch" + 1`);
    sets.set("lease_claimed_at", sql`"lease_claimed_at" = now()`);
    sets.set(
      "lease_expires_at",
      sql`"lease_expires_at" = now() + ${intervalFromMs(ctx.cadence.leaseDurationMs)}`
    );
    sets.set("started_at", sql`"started_at" = COALESCE("started_at", now())`);
  }

  const extra = input.set ?? {};
  if (extra.phase != null) {
    sets.set("phase", sql`"phase" = ${extra.phase}`);
  }
  if ("error" in extra) {
    sets.set("error", sql`"error" = ${extra.error ?? null}`);
  }
  if ("failureDetails" in extra) {
    sets.set(
      "failure_details",
      extra.failureDetails == null
        ? sql`"failure_details" = NULL`
        : sql`"failure_details" = ${jsonbParam(extra.failureDetails)}`
    );
  }
  if (extra.blockingInputs != null) {
    sets.set(
      "blocking_inputs",
      sql`"blocking_inputs" = ${jsonbParam(extra.blockingInputs)}`
    );
  }
  if (extra.artifactSummary != null) {
    sets.set(
      "artifact_summary",
      sql`"artifact_summary" = ${jsonbParam(extra.artifactSummary)}`
    );
  }
  return sets;
}

export async function transitionDeployTask(
  ctx: DeployTaskEngineContext,
  input: DeployTaskTransitionInput
): Promise<DeployTaskRowLite | null> {
  for (const from of input.from) {
    if (!DEPLOY_TASK_TRANSITIONS[from].includes(input.to)) {
      throw new Error(
        `Illegal deploy task transition ${from} -> ${input.to} requested.`
      );
    }
  }

  const sets = transitionSets(ctx, input);
  const wheres: SQL[] = [
    sql`"id" = ${input.taskId}`,
    sql`"status" IN (${statusListSql(input.from)})`,
  ];
  if (input.expectedLeaseEpoch != null) {
    wheres.push(sql`"lease_epoch" = ${input.expectedLeaseEpoch}`);
  }

  const update = sql`UPDATE ${TASKS}
    SET ${sql.join([...sets.values()], sql`, `)}
    WHERE ${sql.join(wheres, sql` AND `)}
    RETURNING ${RETURNING_LITE}`;

  const statement =
    input.event == null
      ? sql`WITH changed AS (${update}) SELECT * FROM changed`
      : sql`WITH changed AS (${update}) ${eventInsertCte(input.event)} SELECT * FROM changed`;

  return await runLiteStatement(ctx, statement, { notify: true });
}

/**
 * Fenced timer renewal; doubles as the cancel-intent poll. Null means the
 * caller's execution was superseded (or ended) and must stop.
 */
export async function renewDeployTaskLease(
  ctx: DeployTaskEngineContext,
  input: { expectedLeaseEpoch: number; taskId: string }
): Promise<DeployTaskRowLite | null> {
  const statement = sql`WITH changed AS (
    UPDATE ${TASKS}
    SET "lease_expires_at" = now() + ${intervalFromMs(ctx.cadence.leaseDurationMs)}
    WHERE "id" = ${input.taskId}
      AND "lease_epoch" = ${input.expectedLeaseEpoch}
      AND "lease_owner" = ${ctx.processId}
      AND "status" IN (${statusListSql(DEPLOY_TASK_LEASED_STATUSES)})
    RETURNING ${RETURNING_LITE}
  ) SELECT * FROM changed`;
  return await runLiteStatement(ctx, statement, { notify: false });
}

/**
 * Records the cancel intent on a leased task (two-phase cancel, ADR 0038).
 * Idempotent at the SQL level: an already-recorded intent loses the guard and
 * returns null; callers re-read and treat it as already satisfied.
 */
export async function recordDeployTaskCancelRequest(
  ctx: DeployTaskEngineContext,
  input: { actionActor?: string; taskId: string }
): Promise<DeployTaskRowLite | null> {
  const statement = sql`WITH changed AS (
    UPDATE ${TASKS}
    SET "cancel_requested_at" = now(), "updated_at" = now()
    WHERE "id" = ${input.taskId}
      AND "cancel_requested_at" IS NULL
      AND "status" IN (${statusListSql(DEPLOY_TASK_LEASED_STATUSES)})
    RETURNING ${RETURNING_LITE}
  ) ${eventInsertCte({
    kind: "deployment_task.cancel_requested",
    message: "Cancellation requested; waiting for the runner to stop.",
    payload:
      input.actionActor == null ? {} : { actionActor: input.actionActor },
  })} SELECT * FROM changed`;
  return await runLiteStatement(ctx, statement, { notify: true });
}

export interface DeployTaskFencedEventInput {
  event: DeployTaskTransitionEvent;
  /** Omit to record an engine event regardless of lease ownership. */
  expectedLeaseEpoch?: number;
  from?: readonly DeployTaskStatus[];
  taskId: string;
}

/**
 * Appends a task event and touches the row (updated_at, optional phase) in
 * one statement, fenced by the lease epoch for runner-driven events.
 */
export async function appendDeployTaskEvent(
  ctx: DeployTaskEngineContext,
  input: DeployTaskFencedEventInput
): Promise<DeployTaskRowLite | null> {
  const wheres: SQL[] = [sql`"id" = ${input.taskId}`];
  if (input.from != null) {
    wheres.push(sql`"status" IN (${statusListSql(input.from)})`);
  }
  if (input.expectedLeaseEpoch != null) {
    wheres.push(sql`"lease_epoch" = ${input.expectedLeaseEpoch}`);
  }
  const phaseSet =
    input.event.phase == null ? sql`` : sql`, "phase" = ${input.event.phase}`;
  const statement = sql`WITH changed AS (
    UPDATE ${TASKS}
    SET "updated_at" = now()${phaseSet}
    WHERE ${sql.join(wheres, sql` AND `)}
    RETURNING ${RETURNING_LITE}
  ) ${eventInsertCte(input.event)} SELECT * FROM changed`;
  return await runLiteStatement(ctx, statement, { notify: true });
}
