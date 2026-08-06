import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import { insertTaskRow } from "../engine/testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "../engine/testing/harness";
import { deployTaskAgentCalls, deployTasks } from "../schema";

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

  it("reports the most recent call excluding the current one for throttling", async () => {
    const { task } = await activeMcpTask("agent-throttle-task");
    await store.enqueueAgentToolCall({
      callId: "completed-1",
      request: { workloads: [] },
      task,
      toolName: "deployment_completed",
    });
    await store.enqueueAgentToolCall({
      callId: "completed-2",
      request: { workloads: [] },
      task,
      toolName: "deployment_completed",
    });

    const previous = await store.lastAgentToolCallAt({
      taskId: task.id,
      toolName: "deployment_completed",
      excludeCallId: "completed-2",
    });

    expect(previous).toBeInstanceOf(Date);
    expect(
      await store.lastAgentToolCallAt({
        taskId: task.id,
        toolName: "deployment_completed",
        excludeCallId: "completed-1",
      })
    ).toBeInstanceOf(Date);
    expect(
      await store.lastAgentToolCallAt({
        taskId: task.id,
        toolName: "template_ready",
        excludeCallId: "completed-1",
      })
    ).toBeNull();
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
      claimOwner: "proc-1:3",
      leaseEpoch: task.leaseEpoch,
      taskId: task.id,
    });
    expect(claimed?.state).toBe("running");
    expect(claimed?.claimOwner).toBe("proc-1:3");
    expect(claimed?.attempt).toBe(1);

    await store.resolveAgentToolCall({
      callId: "call-2",
      claimOwner: "proc-1:3",
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

  it("takes over a stale pending call from an older lease", async () => {
    const { task } = await activeMcpTask("agent-failover-pending-task");
    await store.enqueueAgentToolCall({
      callId: "call-stale",
      request: { sha256: "c".repeat(64) },
      task,
      toolName: "template_ready",
    });

    const claimed = await store.claimNextAgentToolCall({
      claimOwner: "proc-2:9",
      leaseEpoch: 9,
      taskId: task.id,
    });

    expect(claimed?.state).toBe("running");
    expect(claimed?.leaseEpoch).toBe(9);
    expect(claimed?.claimOwner).toBe("proc-2:9");
    expect(claimed?.attempt).toBe(1);
  });

  it("refuses to take over a running call until its claim expires", async () => {
    const { task } = await activeMcpTask("agent-failover-running-task");
    const now = new Date();
    await store.enqueueAgentToolCall({
      callId: "call-running",
      request: {},
      task,
      toolName: "deployment_completed",
    });
    await store.claimNextAgentToolCall({
      claimOwner: "proc-1:3",
      leaseEpoch: task.leaseEpoch,
      now,
      taskId: task.id,
    });

    await expect(
      store.claimNextAgentToolCall({
        claimOwner: "proc-2:9",
        leaseEpoch: 9,
        now,
        taskId: task.id,
      })
    ).resolves.toBeNull();

    const stale = new Date(now.getTime() + 91_000);
    const takenOver = await store.claimNextAgentToolCall({
      claimOwner: "proc-2:9",
      leaseEpoch: 9,
      now: stale,
      taskId: task.id,
    });
    expect(takenOver?.claimOwner).toBe("proc-2:9");
    expect(takenOver?.leaseEpoch).toBe(9);
    expect(takenOver?.attempt).toBe(2);
  });

  it("fails a call when claim attempts are exhausted", async () => {
    const { task } = await activeMcpTask("agent-failover-exhausted-task");
    const now = new Date();
    await store.enqueueAgentToolCall({
      callId: "call-exhausted",
      request: {},
      task,
      toolName: "deployment_completed",
    });
    await store.claimNextAgentToolCall({
      claimOwner: "proc-1:3",
      leaseEpoch: task.leaseEpoch,
      now,
      taskId: task.id,
    });
    const stale = new Date(now.getTime() + 91_000);
    await store.claimNextAgentToolCall({
      claimOwner: "proc-2:9",
      leaseEpoch: 9,
      now: stale,
      taskId: task.id,
    });
    const staleAgain = new Date(stale.getTime() + 91_000);
    const exhausted = await store.claimNextAgentToolCall({
      claimOwner: "proc-3:15",
      leaseEpoch: 15,
      now: staleAgain,
      taskId: task.id,
    });

    expect(exhausted?.state).toBe("failed");
    expect(exhausted?.errorCode).toBe("claim_exhausted");
    expect(exhausted?.attempt).toBe(3);
  });

  it("resolves only for the current claim owner", async () => {
    const { task } = await activeMcpTask("agent-failover-fence-task");
    const now = new Date();
    await store.enqueueAgentToolCall({
      callId: "call-fence",
      request: {},
      task,
      toolName: "deployment_completed",
    });
    await store.claimNextAgentToolCall({
      claimOwner: "proc-1:3",
      leaseEpoch: task.leaseEpoch,
      now,
      taskId: task.id,
    });

    await store.resolveAgentToolCall({
      callId: "call-fence",
      claimOwner: "stale-proc:1",
      response: { decision: "accepted_stop", receiptId: "receipt-stale" },
      taskId: task.id,
    });
    const staleRows = await harness.db
      .select()
      .from(deployTaskAgentCalls)
      .where(eq(deployTaskAgentCalls.callId, "call-fence"));
    expect(staleRows[0]?.state).toBe("running");

    await store.resolveAgentToolCall({
      callId: "call-fence",
      claimOwner: "proc-1:3",
      response: { decision: "accepted_stop", receiptId: "receipt-owner" },
      taskId: task.id,
    });
    const ownerResult = await store.waitForAgentToolCall({
      callId: "call-fence",
      taskId: task.id,
      timeoutMs: 100,
    });
    expect(ownerResult.state).toBe("succeeded");
    expect(ownerResult.response?.receiptId).toBe("receipt-owner");
  });

  it("lets only one claim win for the same pending call", async () => {
    const { task } = await activeMcpTask("agent-failover-race-task");
    await store.enqueueAgentToolCall({
      callId: "call-race",
      request: {},
      task,
      toolName: "deployment_completed",
    });

    const first = await store.claimNextAgentToolCall({
      claimOwner: "proc-1:3",
      leaseEpoch: task.leaseEpoch,
      taskId: task.id,
    });
    const second = await store.claimNextAgentToolCall({
      claimOwner: "proc-2:9",
      leaseEpoch: 9,
      taskId: task.id,
    });

    expect(first?.state).toBe("running");
    expect(second).toBeNull();
  });
});
