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
const LIFECYCLE_WAIT_INITIAL_MS = 100;
const LIFECYCLE_WAIT_MAX_MS = 2000;

function intervalFromMs(ms: number) {
  return sql`make_interval(secs => ${ms / 1000})`;
}

function waitWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  db: AssistantPgDatabase = getAssistantDb(),
  signal?: AbortSignal
): Promise<void> {
  const waitStartedAt = Date.now();
  let waitMs = LIFECYCLE_WAIT_INITIAL_MS;
  while (true) {
    signal?.throwIfAborted();
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
    const jitteredWaitMs = Math.max(
      1,
      Math.round(waitMs * (0.8 + Math.random() * 0.4))
    );
    await waitWithSignal(jitteredWaitMs, signal);
    waitMs = Math.min(waitMs * 2, LIFECYCLE_WAIT_MAX_MS);
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
  leaseOwner: string,
  limit: number
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
        LIMIT ${limit}
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
  leaseOwner: string,
  limit: number
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
        LIMIT ${limit}
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

async function renewCleanupClaim(
  ctx: ChatDevboxLifecycleContext,
  runtime: ClaimedChatDevboxRuntime,
  leaseOwner: string
): Promise<boolean> {
  const renewed = await ctx.db
    .update(assistantDevboxRuntimes)
    .set({
      cleanupLeaseExpiresAt: sql`now() + ${intervalFromMs(LIFECYCLE_CLAIM_TTL_MS)}`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(assistantDevboxRuntimes.upstreamId, runtime.upstreamId),
        eq(assistantDevboxRuntimes.cleanupLeaseOwner, leaseOwner),
        sql`${assistantDevboxRuntimes.cleanupLeaseExpiresAt} > now()`
      )
    )
    .returning({ upstreamId: assistantDevboxRuntimes.upstreamId });
  return renewed.length > 0;
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

async function runConcurrentWave<T>(
  values: readonly T[],
  operation: (value: T) => Promise<boolean>
): Promise<{ failed: number; succeeded: number }> {
  if (values.length > LIFECYCLE_CONCURRENCY) {
    throw new Error("A Devbox cleanup wave exceeds the concurrency limit");
  }
  const outcomes = await Promise.all(
    values.map(async (value) => {
      try {
        return await operation(value);
      } catch (error) {
        console.error("[chat-devbox-lifecycle] operation failed:", error);
        return false;
      }
    })
  );
  return {
    failed: outcomes.filter((outcome) => !outcome).length,
    succeeded: outcomes.filter(Boolean).length,
  };
}

async function processClaimedWaves(
  claim: (
    leaseOwner: string,
    limit: number
  ) => Promise<ClaimedChatDevboxRuntime[]>,
  operation: (
    runtime: ClaimedChatDevboxRuntime,
    leaseOwner: string
  ) => Promise<boolean>
): Promise<{ failed: number; succeeded: number }> {
  // Keep queued rows unclaimed so every lease covers only one active API wave.
  const summary = { failed: 0, succeeded: 0 };
  let remaining = LIFECYCLE_BATCH_SIZE;
  while (remaining > 0) {
    const leaseOwner = randomUUID();
    const candidates = await claim(
      leaseOwner,
      Math.min(LIFECYCLE_CONCURRENCY, remaining)
    );
    if (candidates.length === 0) {
      break;
    }
    remaining -= candidates.length;
    const wave = await runConcurrentWave(candidates, (runtime) =>
      operation(runtime, leaseOwner)
    );
    summary.failed += wave.failed;
    summary.succeeded += wave.succeeded;
  }
  return summary;
}

async function sweepPauses(
  ctx: ChatDevboxLifecycleContext,
  now: Date
): Promise<{ failed: number; succeeded: number }> {
  return await processClaimedWaves(
    (leaseOwner, limit) => claimPauseCandidates(ctx, now, leaseOwner, limit),
    async (runtime, leaseOwner) => {
      if (!(await renewCleanupClaim(ctx, runtime, leaseOwner))) {
        return false;
      }
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
    }
  );
}

async function sweepDeletes(
  ctx: ChatDevboxLifecycleContext,
  now: Date
): Promise<{ failed: number; succeeded: number }> {
  return await processClaimedWaves(
    (leaseOwner, limit) => claimDeleteCandidates(ctx, now, leaseOwner, limit),
    async (runtime, leaseOwner) => {
      if (!(await renewCleanupClaim(ctx, runtime, leaseOwner))) {
        return false;
      }
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
    }
  );
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
