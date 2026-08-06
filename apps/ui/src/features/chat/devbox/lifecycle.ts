import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import { DevboxApiError, deleteDevbox, pauseDevbox } from "@/lib/devbox/client";
import { type AssistantPgDatabase, getAssistantDb } from "../persistence/db";
import { assistantDevboxRuntimes } from "../persistence/schema";

const DELETE_AFTER_PAUSE_MS = 24 * 60 * 60_000;
const DEVBOX_OPERATION_TIMEOUT_MS = 10_000;
const LIFECYCLE_ACTIVITY_WAIT_TIMEOUT_MS = 35_000;
const LIFECYCLE_BATCH_SIZE = 20;
const LIFECYCLE_CLAIM_TTL_MS = 30_000;
const LIFECYCLE_CONCURRENCY = 4;
const LIFECYCLE_RETRY_DELAY_MS = 30_000;
const LIFECYCLE_SWEEP_INTERVAL_MS = 30_000;
const LIFECYCLE_WAIT_POLL_MS = 100;

function intervalFromMs(ms: number) {
  return sql`make_interval(secs => ${ms / 1000})`;
}

interface ChatDevboxLifecycleApi {
  delete: (
    namespace: string,
    runtimeName: string
  ) => Promise<"deleted" | "missing">;
  pause: (
    namespace: string,
    runtimeName: string
  ) => Promise<"missing" | "paused">;
}

export interface ChatDevboxLifecycleContext {
  api: ChatDevboxLifecycleApi;
  db: AssistantPgDatabase;
  now?: () => Date;
}

export interface ChatDevboxLifecycleSweepSummary {
  deleted: number;
  deleteFailed: number;
  paused: number;
  pauseFailed: number;
}

interface ClaimedChatDevboxRuntime {
  namespace: string;
  runtimeName: string;
  upstreamId: string;
}

function isMissingDevboxError(error: unknown): boolean {
  return error instanceof DevboxApiError && error.status === 404;
}

const serverApi: ChatDevboxLifecycleApi = {
  async delete(namespace, runtimeName) {
    try {
      await deleteDevbox(namespace, runtimeName);
      return "deleted";
    } catch (error) {
      if (isMissingDevboxError(error)) {
        return "missing";
      }
      throw error;
    }
  },
  async pause(namespace, runtimeName) {
    try {
      await pauseDevbox(
        namespace,
        runtimeName,
        AbortSignal.timeout(DEVBOX_OPERATION_TIMEOUT_MS)
      );
      return "paused";
    } catch (error) {
      if (isMissingDevboxError(error)) {
        return "missing";
      }
      throw error;
    }
  },
};

export async function recordChatDevboxActivity(
  input: {
    namespace: string;
    pauseDueAt: Date;
    runtimeName: string;
    upstreamId: string;
  },
  db: AssistantPgDatabase = getAssistantDb()
): Promise<void> {
  const waitStartedAt = Date.now();
  while (true) {
    const now = new Date();
    const changed = await db
      .insert(assistantDevboxRuntimes)
      .values({
        namespace: input.namespace,
        pauseDueAt: input.pauseDueAt,
        runtimeName: input.runtimeName,
        upstreamId: input.upstreamId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          cleanupLeaseExpiresAt: null,
          cleanupLeaseOwner: null,
          deleteDueAt: null,
          namespace: input.namespace,
          pausedAt: null,
          pauseDueAt: input.pauseDueAt,
          runtimeName: input.runtimeName,
          updatedAt: now,
        },
        setWhere: or(
          isNull(assistantDevboxRuntimes.cleanupLeaseOwner),
          isNull(assistantDevboxRuntimes.cleanupLeaseExpiresAt),
          sql`${assistantDevboxRuntimes.cleanupLeaseExpiresAt} <= now()`
        ),
        target: assistantDevboxRuntimes.upstreamId,
      })
      .returning({ upstreamId: assistantDevboxRuntimes.upstreamId });
    if (changed.length > 0) {
      return;
    }
    if (Date.now() - waitStartedAt >= LIFECYCLE_ACTIVITY_WAIT_TIMEOUT_MS) {
      throw new Error("Timed out waiting for the Devbox cleanup lease");
    }
    await new Promise((resolve) => setTimeout(resolve, LIFECYCLE_WAIT_POLL_MS));
  }
}

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) {
    return result as Record<string, unknown>[];
  }
  if (
    result != null &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray(result.rows)
  ) {
    return result.rows as Record<string, unknown>[];
  }
  return [];
}

function claimedRuntimesOf(result: unknown): ClaimedChatDevboxRuntime[] {
  return rowsOf(result).flatMap((record) => {
    const namespace = record.namespace;
    const runtimeName = record.runtime_name;
    const upstreamId = record.upstream_id;
    if (
      typeof namespace !== "string" ||
      typeof runtimeName !== "string" ||
      typeof upstreamId !== "string"
    ) {
      return [];
    }
    return [{ namespace, runtimeName, upstreamId }];
  });
}

async function claimPauseCandidates(
  ctx: ChatDevboxLifecycleContext,
  now: Date,
  leaseOwner: string
): Promise<ClaimedChatDevboxRuntime[]> {
  return claimedRuntimesOf(
    await ctx.db.execute(sql`
      WITH candidates AS (
        SELECT "upstream_id"
        FROM ${assistantDevboxRuntimes}
        WHERE "paused_at" IS NULL
          AND "pause_due_at" <= ${now}
          AND (
            "cleanup_lease_expires_at" IS NULL
            OR "cleanup_lease_expires_at" <= now()
          )
        ORDER BY "pause_due_at"
        FOR UPDATE SKIP LOCKED
        LIMIT ${LIFECYCLE_BATCH_SIZE}
      )
      UPDATE ${assistantDevboxRuntimes} runtime
      SET "cleanup_lease_owner" = ${leaseOwner},
          "cleanup_lease_expires_at" = now() + ${intervalFromMs(LIFECYCLE_CLAIM_TTL_MS)},
          "updated_at" = ${now}
      FROM candidates
      WHERE runtime."upstream_id" = candidates."upstream_id"
      RETURNING runtime."upstream_id", runtime."namespace", runtime."runtime_name"
    `)
  );
}

async function claimDeleteCandidates(
  ctx: ChatDevboxLifecycleContext,
  now: Date,
  leaseOwner: string
): Promise<ClaimedChatDevboxRuntime[]> {
  return claimedRuntimesOf(
    await ctx.db.execute(sql`
      WITH candidates AS (
        SELECT "upstream_id"
        FROM ${assistantDevboxRuntimes}
        WHERE "delete_due_at" IS NOT NULL
          AND "delete_due_at" <= ${now}
          AND (
            "cleanup_lease_expires_at" IS NULL
            OR "cleanup_lease_expires_at" <= now()
          )
        ORDER BY "delete_due_at"
        FOR UPDATE SKIP LOCKED
        LIMIT ${LIFECYCLE_BATCH_SIZE}
      )
      UPDATE ${assistantDevboxRuntimes} runtime
      SET "cleanup_lease_owner" = ${leaseOwner},
          "cleanup_lease_expires_at" = now() + ${intervalFromMs(LIFECYCLE_CLAIM_TTL_MS)},
          "updated_at" = ${now}
      FROM candidates
      WHERE runtime."upstream_id" = candidates."upstream_id"
      RETURNING runtime."upstream_id", runtime."namespace", runtime."runtime_name"
    `)
  );
}

async function releaseFailedClaim(
  ctx: ChatDevboxLifecycleContext,
  runtime: ClaimedChatDevboxRuntime,
  leaseOwner: string,
  now: Date
): Promise<void> {
  await ctx.db
    .update(assistantDevboxRuntimes)
    .set({
      cleanupLeaseExpiresAt: sql`now() + ${intervalFromMs(LIFECYCLE_RETRY_DELAY_MS)}`,
      cleanupLeaseOwner: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(assistantDevboxRuntimes.upstreamId, runtime.upstreamId),
        eq(assistantDevboxRuntimes.cleanupLeaseOwner, leaseOwner)
      )
    );
}

async function mapWithConcurrency<T>(
  values: readonly T[],
  operation: (value: T) => Promise<boolean>
): Promise<{ failed: number; succeeded: number }> {
  let failed = 0;
  let succeeded = 0;
  for (let index = 0; index < values.length; index += LIFECYCLE_CONCURRENCY) {
    const outcomes = await Promise.all(
      values.slice(index, index + LIFECYCLE_CONCURRENCY).map(async (value) => {
        try {
          return await operation(value);
        } catch (error) {
          console.error("[chat-devbox-lifecycle] operation failed:", error);
          return false;
        }
      })
    );
    succeeded += outcomes.filter(Boolean).length;
    failed += outcomes.filter((outcome) => !outcome).length;
  }
  return { failed, succeeded };
}

async function sweepPauses(
  ctx: ChatDevboxLifecycleContext,
  now: Date
): Promise<{ failed: number; succeeded: number }> {
  const leaseOwner = randomUUID();
  const candidates = await claimPauseCandidates(ctx, now, leaseOwner);
  return await mapWithConcurrency(candidates, async (runtime) => {
    try {
      const result = await ctx.api.pause(
        runtime.namespace,
        runtime.runtimeName
      );
      if (result === "missing") {
        await ctx.db
          .delete(assistantDevboxRuntimes)
          .where(
            and(
              eq(assistantDevboxRuntimes.upstreamId, runtime.upstreamId),
              eq(assistantDevboxRuntimes.cleanupLeaseOwner, leaseOwner)
            )
          );
        return true;
      }

      await ctx.db
        .update(assistantDevboxRuntimes)
        .set({
          cleanupLeaseExpiresAt: null,
          cleanupLeaseOwner: null,
          deleteDueAt: new Date(now.getTime() + DELETE_AFTER_PAUSE_MS),
          pausedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(assistantDevboxRuntimes.upstreamId, runtime.upstreamId),
            eq(assistantDevboxRuntimes.cleanupLeaseOwner, leaseOwner)
          )
        );
      return true;
    } catch (error) {
      try {
        await releaseFailedClaim(ctx, runtime, leaseOwner, now);
      } catch (releaseError) {
        console.error(
          "[chat-devbox-lifecycle] failed to release cleanup claim:",
          releaseError
        );
      }
      throw error;
    }
  });
}

async function sweepDeletes(
  ctx: ChatDevboxLifecycleContext,
  now: Date
): Promise<{ failed: number; succeeded: number }> {
  const leaseOwner = randomUUID();
  const candidates = await claimDeleteCandidates(ctx, now, leaseOwner);
  return await mapWithConcurrency(candidates, async (runtime) => {
    try {
      await ctx.api.delete(runtime.namespace, runtime.runtimeName);
      await ctx.db
        .delete(assistantDevboxRuntimes)
        .where(
          and(
            eq(assistantDevboxRuntimes.upstreamId, runtime.upstreamId),
            eq(assistantDevboxRuntimes.cleanupLeaseOwner, leaseOwner)
          )
        );
      return true;
    } catch (error) {
      try {
        await releaseFailedClaim(ctx, runtime, leaseOwner, now);
      } catch (releaseError) {
        console.error(
          "[chat-devbox-lifecycle] failed to release cleanup claim:",
          releaseError
        );
      }
      throw error;
    }
  });
}

export async function runChatDevboxLifecycleSweep(
  ctx: ChatDevboxLifecycleContext
): Promise<ChatDevboxLifecycleSweepSummary> {
  const now = ctx.now?.() ?? new Date();
  const pauses = await sweepPauses(ctx, now);
  const deletes = await sweepDeletes(ctx, now);
  return {
    deleteFailed: deletes.failed,
    deleted: deletes.succeeded,
    pauseFailed: pauses.failed,
    paused: pauses.succeeded,
  };
}

const globalRuntime = globalThis as unknown as {
  __sealaiChatDevboxLifecycleBusy?: boolean;
  __sealaiChatDevboxLifecycleTimer?: ReturnType<typeof setInterval>;
};

export function startChatDevboxLifecycleRuntime(): void {
  if (globalRuntime.__sealaiChatDevboxLifecycleTimer != null) {
    return;
  }
  const ctx: ChatDevboxLifecycleContext = {
    api: serverApi,
    db: getAssistantDb(),
  };
  const sweep = () => {
    if (globalRuntime.__sealaiChatDevboxLifecycleBusy) {
      return;
    }
    globalRuntime.__sealaiChatDevboxLifecycleBusy = true;
    runChatDevboxLifecycleSweep(ctx)
      .catch((error) => {
        console.error("[chat-devbox-lifecycle] sweep failed:", error);
      })
      .finally(() => {
        globalRuntime.__sealaiChatDevboxLifecycleBusy = false;
      });
  };
  globalRuntime.__sealaiChatDevboxLifecycleTimer = setInterval(
    sweep,
    LIFECYCLE_SWEEP_INTERVAL_MS
  );
  sweep();
}

export function stopChatDevboxLifecycleRuntimeForTests(): void {
  const timer = globalRuntime.__sealaiChatDevboxLifecycleTimer;
  if (timer != null) {
    clearInterval(timer);
    globalRuntime.__sealaiChatDevboxLifecycleBusy = false;
    globalRuntime.__sealaiChatDevboxLifecycleTimer = undefined;
  }
}
