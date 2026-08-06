import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, isNull, or } from "drizzle-orm";

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

export async function claimNextAgentToolCall(input: {
  taskId: string;
  leaseEpoch: number;
}): Promise<DeployTaskAgentCallRow | null> {
  const db = getDeploymentTaskDb();
  const rows = await db
    .select()
    .from(deployTaskAgentCalls)
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, input.taskId),
        eq(deployTaskAgentCalls.leaseEpoch, input.leaseEpoch),
        eq(deployTaskAgentCalls.state, "pending")
      )
    )
    .orderBy(asc(deployTaskAgentCalls.createdAt))
    .limit(1);
  const row = rows[0];
  if (row == null) {
    return null;
  }
  const claimed = await db
    .update(deployTaskAgentCalls)
    .set({ state: "running", updatedAt: new Date() })
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, row.taskId),
        eq(deployTaskAgentCalls.callId, row.callId),
        eq(deployTaskAgentCalls.state, "pending")
      )
    )
    .returning();
  return claimed[0] ?? null;
}

export async function resolveAgentToolCall(input: {
  taskId: string;
  callId: string;
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
        eq(deployTaskAgentCalls.taskId, input.taskId),
        eq(deployTaskAgentCalls.callId, input.callId),
        or(
          eq(deployTaskAgentCalls.state, "pending"),
          eq(deployTaskAgentCalls.state, "running")
        )
      )
    );
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
