import { type SQL, sql } from "drizzle-orm";

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
import {
  DEPLOY_TASK_LEASED_STATUSES,
  DEPLOY_TASK_TERMINAL_STATUSES,
} from "./transitions";

export interface DeployTaskReaperSummary {
  cancelAckForced: number;
  devboxPaused: number;
  devboxPauseFailed: number;
  interrupted: number;
  interruptedWithCancel: number;
  neverStarted: number;
  purged: number;
  purgeFailed: number;
  timedOut: number;
}

interface SweepVerdict {
  error: string;
  event: { kind: string; message: string; payload: Record<string, unknown> };
  failureDetails: Record<string, unknown> | null;
  to: "cancelled" | "failed";
  where: SQL;
}

async function sweepVerdict(
  ctx: DeployTaskEngineContext,
  verdict: SweepVerdict
): Promise<DeployTaskRowLite[]> {
  const terminalSets =
    verdict.to === "failed"
      ? sql`"status" = 'failed', "error" = ${verdict.error}, "failure_details" = ${
          verdict.failureDetails == null
            ? sql`NULL`
            : jsonbParam(verdict.failureDetails)
        }`
      : sql`"status" = 'cancelled', "error" = NULL, "failure_details" = ${
          verdict.failureDetails == null
            ? sql`NULL`
            : jsonbParam(verdict.failureDetails)
        }`;
  const statement = sql`WITH changed AS (
    UPDATE ${TASKS}
    SET ${terminalSets},
        "completed_at" = now(),
        "updated_at" = now(),
        "lease_owner" = NULL,
        "lease_expires_at" = NULL
    WHERE ${verdict.where}
    RETURNING ${RETURNING_LITE}
  ), recorded_event AS (
    INSERT INTO ${EVENTS} ("task_id", "kind", "message", "payload")
    SELECT changed."id", ${verdict.event.kind}, ${verdict.event.message}, ${jsonbParam(verdict.event.payload)}
    FROM changed
  ) SELECT * FROM changed`;

  const result = await ctx.db.execute(statement);
  const rows = rowsOf(result).map(liteOf);
  for (const row of rows) {
    try {
      await ctx.notify.publish({
        kind: "change",
        namespace: row.namespace,
        projectId: row.projectId,
        taskId: row.taskId,
      });
    } catch (error) {
      console.error("[deploy-task-reaper] notify publish failed:", error);
    }
  }
  return rows;
}

interface DevboxTaskRecord {
  namespace: string;
  projectId: string | null;
  runtimeName: string;
  taskId: string;
}

function devboxRecordsOf(result: unknown): DevboxTaskRecord[] {
  return rowsOf(result).flatMap((record) => {
    const runtimeName = record.runtime_name;
    if (typeof runtimeName !== "string" || runtimeName.trim() === "") {
      return [];
    }
    return [
      {
        namespace: String(record.namespace ?? ""),
        projectId:
          record.project_uid == null ? null : String(record.project_uid),
        runtimeName,
        taskId: String(record.id),
      },
    ];
  });
}

async function markRuntimeState(
  ctx: DeployTaskEngineContext,
  taskId: string,
  runtimeState: "deleted" | "paused"
): Promise<void> {
  await ctx.db.execute(sql`
    UPDATE ${TASKS}
    SET "runtime_state" = ${runtimeState}, "updated_at" = now()
    WHERE "id" = ${taskId}
      AND "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
  `);
}

/**
 * Pause devboxes left running by terminal tasks whose runner never got to
 * pause them (crash, forced resolution). Server-minted devbox JWT — the one
 * engine-side integration (ADR 0037/0038).
 */
async function sweepTerminalDevboxPauses(
  ctx: DeployTaskEngineContext
): Promise<{ failed: number; paused: number }> {
  const candidates = await ctx.db.execute(sql`
    SELECT "id", "namespace", "project_uid", "runtime_name"
    FROM ${TASKS}
    WHERE "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
      AND "runtime_provider" = 'devbox'
      AND "runtime_name" IS NOT NULL
      AND (lower(coalesce("runtime_state", '')) NOT IN ('paused', 'deleted', 'archived'))
    ORDER BY "completed_at" ASC NULLS FIRST
    LIMIT ${ctx.cadence.devboxPauseBatchSize}
  `);
  let paused = 0;
  let failed = 0;
  for (const record of devboxRecordsOf(candidates)) {
    try {
      const result = await ctx.devbox.pauseDevbox(
        record.namespace,
        record.runtimeName
      );
      await markRuntimeState(
        ctx,
        record.taskId,
        result === "missing" ? "deleted" : "paused"
      );
      paused += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `[deploy-task-reaper] devbox pause failed for task ${record.taskId}:`,
        error
      );
    }
  }
  return { failed, paused };
}

/**
 * Retention purge (ADR 0038): devbox first, then the row (events/messages
 * cascade), then the purge notification whose ids are the removal event.
 * Any failure leaves the row for the next sweep — purge is idempotent.
 */
async function sweepRetentionPurge(
  ctx: DeployTaskEngineContext
): Promise<{ failed: number; purged: number }> {
  const dueTasks = await ctx.db.execute(sql`
    SELECT "id", "namespace", "project_uid", "runtime_name", "runtime_provider", "runtime_state"
    FROM ${TASKS}
    WHERE "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
      AND "completed_at" IS NOT NULL
      AND "completed_at" < now() - ${intervalFromMs(ctx.cadence.retentionMs)}
    ORDER BY "completed_at" ASC
    LIMIT ${ctx.cadence.purgeBatchSize}
  `);
  let purged = 0;
  let failed = 0;
  for (const record of rowsOf(dueTasks)) {
    const taskId = String(record.id);
    const namespace = String(record.namespace ?? "");
    const projectId =
      record.project_uid == null ? null : String(record.project_uid);
    try {
      const runtimeName =
        typeof record.runtime_name === "string" ? record.runtime_name : null;
      const isDevbox = record.runtime_provider === "devbox";
      const alreadyDeleted =
        String(record.runtime_state ?? "").toLowerCase() === "deleted";
      if (isDevbox && runtimeName != null && !alreadyDeleted) {
        await ctx.devbox.deleteDevbox(namespace, runtimeName);
        await markRuntimeState(ctx, taskId, "deleted");
      }
      await ctx.db.execute(
        sql`DELETE FROM ${TASKS} WHERE "id" = ${taskId} AND "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})`
      );
      purged += 1;
      try {
        await ctx.notify.publish({
          kind: "purge",
          namespace,
          projectId,
          taskId,
        });
      } catch (error) {
        console.error("[deploy-task-reaper] purge notify failed:", error);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[deploy-task-reaper] purge failed for task ${taskId}:`,
        error
      );
    }
  }
  return { failed, purged };
}

/**
 * One reaper sweep (ADR 0037). Every deadline is compared in SQL against the
 * database clock; every write is a guarded conditional update, so concurrent
 * sweeps from other processes are harmless.
 */
export async function runDeployTaskReaperSweep(
  ctx: DeployTaskEngineContext
): Promise<DeployTaskReaperSummary> {
  const leased = sql`"status" IN (${statusListSql(DEPLOY_TASK_LEASED_STATUSES)})`;

  // Order matters only for attribution: resolve explicit cancel intent
  // before generic expiry so a dead runner with a pending cancel resolves to
  // cancelled, and a live-but-unresponsive one is forced at the deadline.
  const cancelAckForced = await sweepVerdict(ctx, {
    error: "",
    event: {
      kind: "deployment_task.engine_resolved",
      message:
        "Cancellation was not acknowledged in time; the task was resolved to cancelled.",
      payload: { reason: "cancel-ack-deadline", verdict: "cancelled" },
    },
    failureDetails: { detail: "cancel-ack-deadline", reason: "cancelled" },
    to: "cancelled",
    where: sql`${leased} AND "cancel_requested_at" IS NOT NULL AND "cancel_requested_at" < now() - ${intervalFromMs(ctx.cadence.cancelAckDeadlineMs)}`,
  });

  const interruptedWithCancel = await sweepVerdict(ctx, {
    error: "",
    event: {
      kind: "deployment_task.engine_resolved",
      message:
        "The process executing this task died with a cancel pending; resolved to cancelled.",
      payload: { reason: "interrupted-with-cancel", verdict: "cancelled" },
    },
    failureDetails: { detail: "interrupted", reason: "cancelled" },
    to: "cancelled",
    where: sql`${leased} AND "cancel_requested_at" IS NOT NULL AND "lease_expires_at" IS NOT NULL AND "lease_expires_at" < now()`,
  });

  const interrupted = await sweepVerdict(ctx, {
    error:
      "Deployment was interrupted: the process executing it stopped unexpectedly.",
    event: {
      kind: "deployment_task.engine_resolved",
      message:
        "The process executing this task died; the task was resolved to failed (interrupted).",
      payload: { reason: "interrupted", verdict: "failed" },
    },
    failureDetails: { reason: "interrupted" },
    to: "failed",
    where: sql`${leased} AND "cancel_requested_at" IS NULL AND "lease_expires_at" IS NOT NULL AND "lease_expires_at" < now()`,
  });

  const timedOut = await sweepVerdict(ctx, {
    error: "Deployment exceeded the maximum active-run duration.",
    event: {
      kind: "deployment_task.engine_resolved",
      message:
        "The run exceeded the maximum active duration; the task was resolved to failed (timeout).",
      payload: { reason: "max-active-run", verdict: "failed" },
    },
    failureDetails: { reason: "timeout" },
    to: "failed",
    where: sql`${leased} AND "cancel_requested_at" IS NULL AND "lease_claimed_at" IS NOT NULL AND "lease_claimed_at" < now() - ${intervalFromMs(ctx.cadence.maxActiveRunMs)}`,
  });

  const neverStarted = await sweepVerdict(ctx, {
    error: "Deployment never started: the creating process died before launch.",
    event: {
      kind: "deployment_task.engine_resolved",
      message:
        "The task stayed queued past the start deadline; resolved to failed (never started).",
      payload: { reason: "never-started", verdict: "failed" },
    },
    failureDetails: { reason: "never-started" },
    to: "failed",
    where: sql`"status" = 'queued' AND "created_at" < now() - ${intervalFromMs(ctx.cadence.queuedStartDeadlineMs)}`,
  });

  const devboxSweep = await sweepTerminalDevboxPauses(ctx);
  const purgeSweep = await sweepRetentionPurge(ctx);

  return {
    cancelAckForced: cancelAckForced.length,
    devboxPauseFailed: devboxSweep.failed,
    devboxPaused: devboxSweep.paused,
    interrupted: interrupted.length,
    interruptedWithCancel: interruptedWithCancel.length,
    neverStarted: neverStarted.length,
    purgeFailed: purgeSweep.failed,
    purged: purgeSweep.purged,
    timedOut: timedOut.length,
  };
}
