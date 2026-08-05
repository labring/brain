import { randomUUID } from "node:crypto";

import { type SQL, sql } from "drizzle-orm";

import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "../failure-summary";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  type DeployTaskFailureDetails,
  type DeployTaskFailureReason,
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
import {
  DEPLOY_TASK_LEASED_STATUSES,
  DEPLOY_TASK_TERMINAL_STATUSES,
  publishDeployTaskChange,
} from "./transitions";

export interface DeployTaskReaperSummary {
  cancelAckForced: number;
  devboxDeleted: number;
  devboxDeleteFailed: number;
  devboxPaused: number;
  devboxPauseFailed: number;
  interrupted: number;
  interruptedWithCancel: number;
  invalidBlocked: number;
  neverStarted: number;
  timedOut: number;
}

interface SweepVerdict {
  error: string;
  event: { kind: string; message: string; payload: Record<string, unknown> };
  failureDetails: DeployTaskFailureDetails | null;
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
    await publishDeployTaskChange(ctx, row);
  }
  return rows;
}

const LEGACY_EMPTY_BLOCKED_REASON_BY_EVENT_KIND: Record<
  string,
  DeployTaskFailureReason
> = {
  "deployment_task.build_runtime_unavailable": "build-runtime-unavailable",
  "deployment_task.gateway_unavailable": "gateway-not-exposed",
  "deployment_task.output_missing": "deployment-output-missing",
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalidBlockedFailureReason(
  record: Record<string, unknown>
): DeployTaskFailureReason {
  const persistedReason = recordValue(record.event_payload)?.reason;
  if (isDeployTaskFailureReason(persistedReason)) {
    return persistedReason;
  }
  const eventKind = String(record.event_kind ?? "");
  return LEGACY_EMPTY_BLOCKED_REASON_BY_EVENT_KIND[eventKind] ?? "unknown";
}

function invalidBlockedTaskWhere(): SQL {
  return sql`
    "status" = 'blocked'
    AND (
      jsonb_array_length(COALESCE("blocking_inputs", '[]'::jsonb)) = 0
      OR (
        COALESCE("runner" ->> 'kind', '') = 'ai'
        AND COALESCE(
          "artifact_summary" ->> 'publicProjectionVersion',
          ''
        ) <> ${String(CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION)}
      )
    )
  `;
}

async function sweepInvalidBlockedTasks(
  ctx: DeployTaskEngineContext
): Promise<number> {
  const candidates = rowsOf(
    await ctx.db.execute(sql`
      SELECT
        task."id",
        jsonb_array_length(COALESCE(task."blocking_inputs", '[]'::jsonb))
          AS "blocking_input_count",
        cause."kind" AS "event_kind",
        cause."payload" AS "event_payload"
      FROM ${TASKS} task
      LEFT JOIN LATERAL (
        SELECT event."kind", event."payload"
        FROM ${EVENTS} event
        WHERE event."task_id" = task."id"
          AND (
            event."payload" ->> 'reason' IS NOT NULL
            OR event."kind" IN (
              'deployment_task.build_runtime_unavailable',
              'deployment_task.gateway_unavailable',
              'deployment_task.output_missing'
            )
          )
        ORDER BY event."seq" DESC
        LIMIT 1
      ) cause ON true
      WHERE ${invalidBlockedTaskWhere()}
    `)
  );

  let repaired = 0;
  for (const candidate of candidates) {
    const taskId = String(candidate.id ?? "");
    if (taskId === "") {
      continue;
    }
    const reason = invalidBlockedFailureReason(candidate);
    const message = deploymentFailureMessage(reason);
    const detail =
      Number(candidate.blocking_input_count) === 0
        ? "empty-blocking-inputs"
        : "untrusted-ai-blocking-inputs";
    const rows = await sweepVerdict(ctx, {
      error: message,
      event: {
        kind: "deployment_task.engine_resolved",
        message,
        payload: {
          detail,
          reason,
          verdict: "failed",
        },
      },
      failureDetails: {
        detail,
        failureMessage: message,
        reason,
      },
      to: "failed",
      where: sql`"id" = ${taskId} AND ${invalidBlockedTaskWhere()}`,
    });
    repaired += rows.length;
  }
  return repaired;
}

interface DevboxTaskRecord {
  namespace: string;
  runtimeName: string;
  runtimeState: string;
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
        runtimeName,
        runtimeState: String(record.runtime_state ?? "").toLowerCase(),
        taskId: String(record.id),
      },
    ];
  });
}

async function markRuntimeState(
  ctx: DeployTaskEngineContext,
  taskId: string,
  runtimeState: "deleted" | "paused",
  cleanupLeaseOwner: string
): Promise<void> {
  if (runtimeState === "paused") {
    await ctx.db.execute(sql`
      UPDATE ${TASKS}
      SET "runtime_state" = 'paused',
          "runtime_paused_at" = coalesce("runtime_paused_at", now()),
          "runtime_cleanup_lease_owner" = NULL,
          "runtime_cleanup_lease_expires_at" = NULL
      WHERE "id" = ${taskId}
        AND "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
        AND "runtime_cleanup_lease_owner" = ${cleanupLeaseOwner}
    `);
    return;
  }
  await ctx.db.execute(sql`
    UPDATE ${TASKS}
    SET "runtime_state" = 'deleted',
        "runtime_cleanup_lease_owner" = NULL,
        "runtime_cleanup_lease_expires_at" = NULL
    WHERE "id" = ${taskId}
      AND "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
      AND "runtime_cleanup_lease_owner" = ${cleanupLeaseOwner}
  `);
}

async function releaseDevboxCleanupClaim(
  ctx: DeployTaskEngineContext,
  taskId: string,
  cleanupLeaseOwner: string
): Promise<void> {
  await ctx.db.execute(sql`
    UPDATE ${TASKS}
    SET "runtime_cleanup_lease_owner" = NULL,
        "runtime_cleanup_lease_expires_at" = now() + ${intervalFromMs(ctx.cadence.reaperIntervalMs)}
    WHERE "id" = ${taskId}
      AND "runtime_cleanup_lease_owner" = ${cleanupLeaseOwner}
  `);
}

async function processWithConcurrency<T>(
  records: readonly T[],
  concurrency: number,
  operation: (record: T) => Promise<boolean>
): Promise<{ failed: number; succeeded: number }> {
  let failed = 0;
  let succeeded = 0;
  for (let index = 0; index < records.length; index += concurrency) {
    const outcomes = await Promise.all(
      records.slice(index, index + concurrency).map(operation)
    );
    succeeded += outcomes.filter(Boolean).length;
    failed += outcomes.filter((outcome) => !outcome).length;
  }
  return { failed, succeeded };
}

/**
 * Pause devboxes left running by terminal tasks whose runner never got to
 * pause them (crash, forced resolution). A runtime whose secret cleanup
 * failed is deleted instead so it can never be archived. Server-minted devbox
 * JWT — the one engine-side integration (ADR 0037/0038).
 */
async function sweepTerminalDevboxPauses(
  ctx: DeployTaskEngineContext
): Promise<{ failed: number; paused: number }> {
  const cleanupLeaseOwner = `${ctx.processId}:${randomUUID()}`;
  const candidates = await ctx.db.execute(sql`
    WITH candidates AS (
      SELECT "id"
      FROM ${TASKS}
      WHERE "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
        AND "runtime_provider" = 'devbox'
        AND "runtime_name" IS NOT NULL
        AND (lower(coalesce("runtime_state", '')) NOT IN ('paused', 'deleted', 'archived'))
        AND (
          "runtime_cleanup_lease_expires_at" IS NULL
          OR "runtime_cleanup_lease_expires_at" <= now()
        )
      ORDER BY "completed_at" ASC NULLS FIRST
      FOR UPDATE SKIP LOCKED
      LIMIT ${ctx.cadence.devboxPauseBatchSize}
    )
    UPDATE ${TASKS} task
    SET "runtime_cleanup_lease_owner" = ${cleanupLeaseOwner},
        "runtime_cleanup_lease_expires_at" = now() + ${intervalFromMs(ctx.cadence.leaseDurationMs)}
    FROM candidates
    WHERE task."id" = candidates."id"
    RETURNING task."id", task."namespace", task."runtime_name", task."runtime_state"
  `);
  const result = await processWithConcurrency(
    devboxRecordsOf(candidates),
    ctx.cadence.devboxOperationConcurrency,
    async (record) => {
      try {
        if (record.runtimeState === "cleanup-failed") {
          await ctx.devbox.deleteDevbox(record.namespace, record.runtimeName);
          await markRuntimeState(
            ctx,
            record.taskId,
            "deleted",
            cleanupLeaseOwner
          );
          return true;
        }
        const pauseResult = await ctx.devbox.pauseDevbox(
          record.namespace,
          record.runtimeName
        );
        await markRuntimeState(
          ctx,
          record.taskId,
          pauseResult === "missing" ? "deleted" : "paused",
          cleanupLeaseOwner
        );
        return true;
      } catch (error) {
        try {
          await releaseDevboxCleanupClaim(
            ctx,
            record.taskId,
            cleanupLeaseOwner
          );
        } catch (releaseError) {
          console.error(
            `[deploy-task-reaper] cleanup claim release failed for task ${record.taskId}:`,
            releaseError
          );
        }
        console.error(
          `[deploy-task-reaper] devbox pause failed for task ${record.taskId}:`,
          error
        );
        return false;
      }
    }
  );
  return { failed: result.failed, paused: result.succeeded };
}

/**
 * Delete paused terminal-task Devboxes after their runtime retention window.
 * Task rows, events, messages, and deployment results are permanent records.
 */
async function sweepPausedDevboxDeletes(
  ctx: DeployTaskEngineContext
): Promise<{ deleted: number; failed: number }> {
  const cleanupLeaseOwner = `${ctx.processId}:${randomUUID()}`;
  const candidates = await ctx.db.execute(sql`
    WITH candidates AS (
      SELECT "id"
      FROM ${TASKS}
      WHERE "status" IN (${statusListSql(DEPLOY_TASK_TERMINAL_STATUSES)})
        AND "runtime_provider" = 'devbox'
        AND "runtime_name" IS NOT NULL
        AND lower(coalesce("runtime_state", '')) IN ('paused', 'archived')
        AND "runtime_paused_at" IS NOT NULL
        AND "runtime_paused_at" <= now() - ${intervalFromMs(ctx.cadence.devboxDeleteAfterPauseMs)}
        AND (
          "runtime_cleanup_lease_expires_at" IS NULL
          OR "runtime_cleanup_lease_expires_at" <= now()
        )
      ORDER BY "runtime_paused_at" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${ctx.cadence.devboxDeleteBatchSize}
    )
    UPDATE ${TASKS} task
    SET "runtime_cleanup_lease_owner" = ${cleanupLeaseOwner},
        "runtime_cleanup_lease_expires_at" = now() + ${intervalFromMs(ctx.cadence.leaseDurationMs)}
    FROM candidates
    WHERE task."id" = candidates."id"
    RETURNING task."id", task."namespace", task."runtime_name"
  `);
  const result = await processWithConcurrency(
    devboxRecordsOf(candidates),
    ctx.cadence.devboxOperationConcurrency,
    async (record) => {
      try {
        await ctx.devbox.deleteDevbox(record.namespace, record.runtimeName);
        await markRuntimeState(
          ctx,
          record.taskId,
          "deleted",
          cleanupLeaseOwner
        );
        return true;
      } catch (error) {
        try {
          await releaseDevboxCleanupClaim(
            ctx,
            record.taskId,
            cleanupLeaseOwner
          );
        } catch (releaseError) {
          console.error(
            `[deploy-task-reaper] cleanup claim release failed for task ${record.taskId}:`,
            releaseError
          );
        }
        console.error(
          `[deploy-task-reaper] devbox delete failed for task ${record.taskId}:`,
          error
        );
        return false;
      }
    }
  );
  return { deleted: result.succeeded, failed: result.failed };
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
  const interruptedMessage = deploymentFailureMessage("interrupted");
  const timeoutMessage = deploymentFailureMessage("timeout");
  const neverStartedMessage = deploymentFailureMessage("never-started");

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

  const timedOut = await sweepVerdict(ctx, {
    error: timeoutMessage,
    event: {
      kind: "deployment_task.engine_resolved",
      message: timeoutMessage,
      payload: { reason: "timeout", verdict: "failed" },
    },
    failureDetails: { failureMessage: timeoutMessage, reason: "timeout" },
    to: "failed",
    where: sql`${leased} AND "cancel_requested_at" IS NULL AND "lease_claimed_at" IS NOT NULL AND "lease_claimed_at" < now() - ${intervalFromMs(ctx.cadence.maxActiveRunMs)}`,
  });

  const interrupted = await sweepVerdict(ctx, {
    error: interruptedMessage,
    event: {
      kind: "deployment_task.engine_resolved",
      message: interruptedMessage,
      payload: { reason: "interrupted", verdict: "failed" },
    },
    failureDetails: {
      failureMessage: interruptedMessage,
      reason: "interrupted",
    },
    to: "failed",
    where: sql`${leased} AND "cancel_requested_at" IS NULL AND "lease_expires_at" IS NOT NULL AND "lease_expires_at" < now()`,
  });

  const neverStarted = await sweepVerdict(ctx, {
    error: neverStartedMessage,
    event: {
      kind: "deployment_task.engine_resolved",
      message: neverStartedMessage,
      payload: { reason: "never-started", verdict: "failed" },
    },
    failureDetails: {
      failureMessage: neverStartedMessage,
      reason: "never-started",
    },
    to: "failed",
    where: sql`"status" = 'queued' AND "created_at" < now() - ${intervalFromMs(ctx.cadence.queuedStartDeadlineMs)}`,
  });

  // `blocked` is exclusively a user-input wait state. Older runners could
  // park without any inputs, leaving no resume path and no terminal cleanup.
  // Preserve a safe historical reason when possible; otherwise fail closed
  // to unknown instead of inventing a more specific root cause.
  const invalidBlocked = await sweepInvalidBlockedTasks(ctx);

  const devboxSweep = await sweepTerminalDevboxPauses(ctx);
  const devboxDeleteSweep = await sweepPausedDevboxDeletes(ctx);

  return {
    cancelAckForced: cancelAckForced.length,
    devboxPauseFailed: devboxSweep.failed,
    devboxPaused: devboxSweep.paused,
    devboxDeleteFailed: devboxDeleteSweep.failed,
    devboxDeleted: devboxDeleteSweep.deleted,
    invalidBlocked,
    interrupted: interrupted.length,
    interruptedWithCancel: interruptedWithCancel.length,
    neverStarted: neverStarted.length,
    timedOut: timedOut.length,
  };
}
