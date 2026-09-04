import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, ne, or } from "drizzle-orm";

import { getDeploymentTaskDb } from "../db";
import {
  type DeployTaskAgentCallResponse,
  type DeployTaskAgentCallRow,
  type DeployTaskAgentToolName,
  type DeployTaskRow,
  deployTaskAgentCalls,
  deployTasks,
} from "../schema";

export const AGENT_CONTROL_PROTOCOL = "mcp-v1" as const;
export const AGENT_CONTROL_TOKEN_BYTES = 32;
export const AGENT_CONTROL_CALL_WAIT_MS = 55_000;
export const AGENT_CONTROL_POLL_MS = 250;
export const AGENT_CONTROL_CALL_CLAIM_MS = 90_000;
export const AGENT_CONTROL_CALL_MAX_ATTEMPTS = 3;
export const AGENT_CONTROL_CALL_CLAIM_EXHAUSTED = "claim_exhausted" as const;
export const AGENT_DEPLOYMENT_COMPLETED_MIN_INTERVAL_MS = 5000;

/**
 * `claim_exhausted` alone tells the Agent nothing actionable; when a retried
 * call carried a (safe, runner-allowlisted) error code, the exhausted verdict
 * keeps it as a suffix: `claim_exhausted:<code>`.
 */
export function agentControlClaimExhaustedCode(
  lastErrorCode: string | null | undefined
): string {
  return lastErrorCode == null || lastErrorCode === ""
    ? AGENT_CONTROL_CALL_CLAIM_EXHAUSTED
    : `${AGENT_CONTROL_CALL_CLAIM_EXHAUSTED}:${lastErrorCode}`;
}

export function hashAgentControlCapability(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createAgentControlCapability(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(AGENT_CONTROL_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashAgentControlCapability(token) };
}

export async function findTaskForAgentCapability(
  token: string
): Promise<DeployTaskRow | null> {
  const tokenHash = hashAgentControlCapability(token);
  const db = getDeploymentTaskDb();
  const rows = await db
    .select()
    .from(deployTasks)
    .where(
      and(
        eq(deployTasks.agentControlTokenHash, tokenHash),
        eq(deployTasks.agentProtocol, AGENT_CONTROL_PROTOCOL),
        isNull(deployTasks.agentControlTokenRevokedAt),
        or(
          eq(deployTasks.status, "queued"),
          eq(deployTasks.status, "running"),
          eq(deployTasks.status, "applying")
        )
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function bindAgentCapabilityToSession(input: {
  taskId: string;
  tokenHash: string;
  gatewaySessionId: string;
}): Promise<boolean> {
  const db = getDeploymentTaskDb();
  const result = await db
    .update(deployTasks)
    .set({ gatewaySessionId: input.gatewaySessionId, updatedAt: new Date() })
    .where(
      and(
        eq(deployTasks.id, input.taskId),
        eq(deployTasks.agentControlTokenHash, input.tokenHash),
        eq(deployTasks.agentProtocol, AGENT_CONTROL_PROTOCOL),
        isNull(deployTasks.agentControlTokenRevokedAt)
      )
    )
    .returning({ id: deployTasks.id });
  return result.length === 1;
}

export async function enqueueAgentToolCall(input: {
  task: DeployTaskRow;
  callId: string;
  toolName: DeployTaskAgentToolName;
  request: Record<string, unknown>;
}): Promise<DeployTaskAgentCallRow> {
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input.request), "utf8")
    .digest("hex");
  const db = getDeploymentTaskDb();
  await db
    .insert(deployTaskAgentCalls)
    .values({
      taskId: input.task.id,
      callId: input.callId,
      leaseEpoch: input.task.leaseEpoch,
      request: input.request,
      requestHash,
      toolName: input.toolName,
    })
    .onConflictDoNothing();

  const rows = await db
    .select()
    .from(deployTaskAgentCalls)
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, input.task.id),
        eq(deployTaskAgentCalls.callId, input.callId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row == null) {
    throw new Error("Agent tool call was not persisted.");
  }
  if (row.toolName !== input.toolName || row.requestHash !== requestHash) {
    throw new Error("Agent tool call id was reused with different arguments.");
  }
  return row;
}

/**
 * Returns the most recent persisted call of a tool for the task, excluding
 * the given call id. Used to throttle repeated `deployment_completed` calls
 * so a runaway Agent cannot amplify Brain-side observation cost.
 */
export async function lastAgentToolCallAt(input: {
  taskId: string;
  toolName: DeployTaskAgentToolName;
  excludeCallId: string;
}): Promise<Date | null> {
  const db = getDeploymentTaskDb();
  const rows = await db
    .select({ createdAt: deployTaskAgentCalls.createdAt })
    .from(deployTaskAgentCalls)
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, input.taskId),
        eq(deployTaskAgentCalls.toolName, input.toolName),
        ne(deployTaskAgentCalls.callId, input.excludeCallId)
      )
    )
    .orderBy(desc(deployTaskAgentCalls.createdAt))
    .limit(1);
  return rows[0]?.createdAt ?? null;
}

/**
 * Atomically claim the oldest processable Agent tool call for the current
 * run. A `pending` call is claimable by any active Runner. A `running` call
 * is only claimable after its `claimExpiresAt` passes (the previous Runner
 * crashed or stalled), at which point the lease epoch is taken over and the
 * attempt counter is bumped. When attempts reach the configured maximum the
 * call is failed with `claim_exhausted[:<last error code>]` so the MCP client
 * can retry instead of waiting forever; callers must not run the handler for
 * a row returned in the `failed` state.
 */
export async function claimNextAgentToolCall(input: {
  taskId: string;
  leaseEpoch: number;
  claimOwner: string;
  now?: Date;
}): Promise<DeployTaskAgentCallRow | null> {
  const db = getDeploymentTaskDb();
  const now = input.now ?? new Date();
  const claimExpiresAt = new Date(now.getTime() + AGENT_CONTROL_CALL_CLAIM_MS);
  const claimable = or(
    eq(deployTaskAgentCalls.state, "pending"),
    and(
      eq(deployTaskAgentCalls.state, "running"),
      or(
        isNull(deployTaskAgentCalls.claimExpiresAt),
        lt(deployTaskAgentCalls.claimExpiresAt, now)
      )
    )
  );
  const rows = await db
    .select()
    .from(deployTaskAgentCalls)
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, input.taskId),
        claimable,
        lt(deployTaskAgentCalls.attempt, AGENT_CONTROL_CALL_MAX_ATTEMPTS)
      )
    )
    .orderBy(asc(deployTaskAgentCalls.createdAt))
    .limit(1);
  const row = rows[0];
  if (row == null) {
    return null;
  }
  const exhausted = row.attempt + 1 >= AGENT_CONTROL_CALL_MAX_ATTEMPTS;
  const claimed = await db
    .update(deployTaskAgentCalls)
    .set({
      attempt: row.attempt + 1,
      claimExpiresAt,
      claimOwner: input.claimOwner,
      errorCode: exhausted
        ? agentControlClaimExhaustedCode(row.errorCode)
        : row.errorCode,
      leaseEpoch: input.leaseEpoch,
      state: exhausted ? "failed" : "running",
      updatedAt: now,
    })
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, row.taskId),
        eq(deployTaskAgentCalls.callId, row.callId),
        claimable,
        lt(deployTaskAgentCalls.attempt, AGENT_CONTROL_CALL_MAX_ATTEMPTS)
      )
    )
    .returning();
  return claimed[0] ?? null;
}

export async function resolveAgentToolCall(input: {
  taskId: string;
  callId: string;
  claimOwner: string;
  response?: DeployTaskAgentCallResponse;
  errorCode?: string;
}): Promise<void> {
  const db = getDeploymentTaskDb();
  await db
    .update(deployTaskAgentCalls)
    .set({
      errorCode: input.errorCode ?? null,
      response: input.response ?? null,
      state: input.errorCode == null ? "succeeded" : "failed",
      updatedAt: new Date(),
      completedAt: new Date(),
    })
    .where(
      and(
        eq(deployTaskAgentCalls.claimOwner, input.claimOwner),
        eq(deployTaskAgentCalls.taskId, input.taskId),
        eq(deployTaskAgentCalls.callId, input.callId),
        eq(deployTaskAgentCalls.state, "running")
      )
    );
}

/**
 * Return a transiently failed control call to the durable inbox. The same
 * MCP request remains open while the runner makes another bounded attempt.
 * `errorCode` records why this attempt failed so an eventual exhaustion can
 * report it; it must already be a safe (allowlisted) code.
 */
export async function retryAgentToolCall(input: {
  taskId: string;
  callId: string;
  claimOwner: string;
  errorCode?: string;
}): Promise<boolean> {
  const db = getDeploymentTaskDb();
  const rows = await db
    .update(deployTaskAgentCalls)
    .set({
      claimExpiresAt: null,
      claimOwner: null,
      completedAt: null,
      errorCode: input.errorCode ?? null,
      response: null,
      state: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(deployTaskAgentCalls.claimOwner, input.claimOwner),
        eq(deployTaskAgentCalls.taskId, input.taskId),
        eq(deployTaskAgentCalls.callId, input.callId),
        eq(deployTaskAgentCalls.state, "running"),
        lt(deployTaskAgentCalls.attempt, AGENT_CONTROL_CALL_MAX_ATTEMPTS)
      )
    )
    .returning({ callId: deployTaskAgentCalls.callId });
  return rows.length === 1;
}

export async function waitForAgentToolCall(input: {
  taskId: string;
  callId: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<DeployTaskAgentCallRow> {
  const deadline = Date.now() + (input.timeoutMs ?? AGENT_CONTROL_CALL_WAIT_MS);
  while (Date.now() < deadline) {
    input.signal?.throwIfAborted();
    const rows = await getDeploymentTaskDb()
      .select()
      .from(deployTaskAgentCalls)
      .where(
        and(
          eq(deployTaskAgentCalls.taskId, input.taskId),
          eq(deployTaskAgentCalls.callId, input.callId)
        )
      )
      .limit(1);
    const row = rows[0];
    if (row == null) {
      throw new Error("Agent tool call disappeared from the durable inbox.");
    }
    if (row.state === "succeeded" || row.state === "failed") {
      return row;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(
          input.signal?.reason ?? new DOMException("Aborted", "AbortError")
        );
      };
      const timer = setTimeout(() => {
        input.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, AGENT_CONTROL_POLL_MS);
      if (input.signal?.aborted) {
        onAbort();
        return;
      }
      input.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
  throw new Error("Timed out waiting for the deployment Agent tool call.");
}
