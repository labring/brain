import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { insertTaskRow } from "../engine/testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "../engine/testing/harness";
import { deployTasks } from "../schema";

const requireModule = createRequire(import.meta.url);
let harness: DeployTaskTestHarness;

mock.module("server-only", () => ({}));
mock.module("../db", () => ({
  getDeploymentTaskDb: () => harness.db,
}));

const store = requireModule("./store") as typeof import("./store");

beforeAll(async () => {
  harness = await createDeployTaskTestHarness();
});

afterAll(async () => {
  await harness.close();
});

async function activeMcpTask(id: string) {
  const task = await insertTaskRow(harness.db, {
    id,
    leaseEpoch: 3,
    status: "running",
  });
  const capability = store.createAgentControlCapability();
  const [updated] = await harness.db
    .update(deployTasks)
    .set({
      agentControlTokenHash: capability.tokenHash,
      agentProtocol: "mcp-v1",
    })
    .where(eq(deployTasks.id, task.id))
    .returning();
  if (updated == null) {
    throw new Error("Failed to prepare MCP task fixture.");
  }
  return { capability, task: updated };
}

describe("deployment Agent durable tool inbox", () => {
  it("authenticates an active task with an opaque capability", async () => {
    const { capability, task } = await activeMcpTask("agent-auth-task");

    expect(capability.token).not.toContain(capability.tokenHash);
    expect(capability.tokenHash).toHaveLength(64);
    expect((await store.findTaskForAgentCapability(capability.token))?.id).toBe(
      task.id
    );
    expect(
      await store.findTaskForAgentCapability("invalid-capability")
    ).toBeNull();
  });

  it("is idempotent for the same call and rejects argument reuse", async () => {
    const { task } = await activeMcpTask("agent-idempotency-task");
    const first = await store.enqueueAgentToolCall({
      callId: "call-1",
      request: { sha256: "a".repeat(64) },
      task,
      toolName: "template_ready",
    });
    const duplicate = await store.enqueueAgentToolCall({
      callId: "call-1",
      request: { sha256: "a".repeat(64) },
      task,
      toolName: "template_ready",
    });

    expect(duplicate.requestHash).toBe(first.requestHash);
    await expect(
      store.enqueueAgentToolCall({
        callId: "call-1",
        request: { sha256: "b".repeat(64) },
        task,
        toolName: "template_ready",
      })
    ).rejects.toThrow("reused with different arguments");
  });

  it("claims, resolves, and returns a durable response", async () => {
    const { task } = await activeMcpTask("agent-response-task");
    await store.enqueueAgentToolCall({
      callId: "call-2",
      request: {},
      task,
      toolName: "deployment_completed",
    });
    const claimed = await store.claimNextAgentToolCall({
      leaseEpoch: task.leaseEpoch,
      taskId: task.id,
    });
    expect(claimed?.state).toBe("running");

    await store.resolveAgentToolCall({
      callId: "call-2",
      response: { decision: "accepted_stop", receiptId: "receipt-1" },
      taskId: task.id,
    });
    const result = await store.waitForAgentToolCall({
      callId: "call-2",
      taskId: task.id,
      timeoutMs: 1000,
    });
    expect(result.state).toBe("succeeded");
    expect(result.response?.decision).toBe("accepted_stop");
  });
});
