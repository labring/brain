import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { and, eq } from "drizzle-orm";
import { DeployTaskRunSupersededError } from "./engine/errors";
import { insertTaskRow } from "./engine/testing/fixtures";
import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "./engine/testing/harness";
import {
  type DeployTaskAgentCallRow,
  type DeployTaskRow,
  deployTaskAgentCalls,
  deployTasks,
} from "./schema";

// Drives the real managed control-call dispatch (claim → handler → resolve /
// retry) against the PGlite-backed durable inbox, with only the Devbox exec
// and the engine write surface faked. Everything loads synchronously via
// require and every module mock is restored in afterAll — see
// runner.template-preserve.test.ts for why.

const requireModule = createRequire(import.meta.url);
let harness: DeployTaskTestHarness;

interface DevboxExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}
let devboxExecImpl: () => Promise<DevboxExecResult>;
let devboxExecCalls = 0;
const beginApplyingCalls: string[] = [];
const runController = new AbortController();

mock.module("server-only", () => ({}));

const realDb = requireModule("./db");
const realDevboxClient = requireModule("@/lib/devbox/client");
const realRunnerWrites = requireModule("./runner-writes");

afterAll(async () => {
  mock.module("./db", () => ({ ...realDb }));
  mock.module("@/lib/devbox/client", () => ({ ...realDevboxClient }));
  mock.module("./runner-writes", () => ({ ...realRunnerWrites }));
  await harness.close();
});

mock.module("./db", () => ({
  getDeploymentTaskDb: () => harness.db,
}));

mock.module("@/lib/devbox/client", () => ({
  ...realDevboxClient,
  execDevbox: async () => {
    devboxExecCalls += 1;
    return { data: await devboxExecImpl() };
  },
}));

mock.module("./runner-writes", () => ({
  ...realRunnerWrites,
  // Mirrors the engine's guarded transition (`from: ["running"]`): a second
  // beginApplying against an `applying` row loses the write and is reported
  // as a supersession, exactly like DeployTaskHandle.beginApplying.
  deployTaskBeginApplying: async (taskId: string) => {
    beginApplyingCalls.push(taskId);
    const rows = await harness.db
      .update(deployTasks)
      .set({ phase: "apply", status: "applying" })
      .where(and(eq(deployTasks.id, taskId), eq(deployTasks.status, "running")))
      .returning({ id: deployTasks.id });
    if (rows.length === 0) {
      throw new DeployTaskRunSupersededError();
    }
  },
  deployTaskRunSignal: () => runController.signal,
  throwIfDeployTaskAborted: () => undefined,
  updateDeployTaskState: async (
    taskId: string,
    fields: Record<string, unknown>
  ) => {
    await harness.db
      .update(deployTasks)
      .set(fields)
      .where(eq(deployTasks.id, taskId));
  },
}));

const { processPendingManagedAgentToolCalls } = requireModule(
  "./runner"
) as typeof import("./runner");
const store = requireModule(
  "./agent-tools/store"
) as typeof import("./agent-tools/store");

function templateYaml(version: string): string {
  return `apiVersion: app.sealos.io/v1
kind: Template
metadata:
  name: demo-app
spec:
  templateType: inline
  defaults:
    app_name:
      type: string
      value: demo-app
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: \${{ defaults.app_name }}
data:
  version: ${version}
`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function serveTemplate(yaml: string): void {
  devboxExecImpl = () =>
    Promise.resolve({ exitCode: 0, stderr: "", stdout: yaml });
}

async function activeManagedTask(id: string): Promise<DeployTaskRow> {
  return await insertTaskRow(harness.db, {
    id,
    leaseEpoch: 3,
    leaseOwner: "proc-1",
    phase: "plan",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    status: "running",
  });
}

async function callRow(
  taskId: string,
  callId: string
): Promise<DeployTaskAgentCallRow> {
  const rows = await harness.db
    .select()
    .from(deployTaskAgentCalls)
    .where(
      and(
        eq(deployTaskAgentCalls.taskId, taskId),
        eq(deployTaskAgentCalls.callId, callId)
      )
    );
  const row = rows[0];
  if (row == null) {
    throw new Error(`Missing agent call ${callId}`);
  }
  return row;
}

async function taskRow(taskId: string): Promise<DeployTaskRow> {
  const rows = await harness.db
    .select()
    .from(deployTasks)
    .where(eq(deployTasks.id, taskId));
  const row = rows[0];
  if (row == null) {
    throw new Error(`Missing task ${taskId}`);
  }
  return row;
}

function processCalls(
  task: DeployTaskRow,
  signals: Parameters<
    typeof processPendingManagedAgentToolCalls
  >[0]["signals"] = {}
) {
  return processPendingManagedAgentToolCalls({
    allowedDomain: "example.test",
    deadlineAtMs: Date.now() + 60_000,
    inputsSubmitted: false,
    namespace: task.namespace,
    runtimeName: "sealai-deploy-demo",
    signals,
    task,
  });
}

beforeAll(async () => {
  harness = await createDeployTaskTestHarness();
});

beforeEach(() => {
  beginApplyingCalls.length = 0;
  devboxExecCalls = 0;
  serveTemplate(templateYaml("v1"));
});

describe("managed deployment Agent control calls", () => {
  it("answers template_ready twice in one turn with continue when the digest changes", async () => {
    const task = await activeManagedTask("mcp-template-ready-twice");
    const signals = {};
    const first = templateYaml("v1");
    const second = templateYaml("v2");

    serveTemplate(first);
    await store.enqueueAgentToolCall({
      callId: "ready-1",
      request: { sha256: sha256(first) },
      task,
      toolName: "template_ready",
    });
    await processCalls(task, signals);

    const firstResult = await callRow(task.id, "ready-1");
    expect(firstResult.state).toBe("succeeded");
    expect(firstResult.response?.decision).toBe("continue");
    expect(firstResult.response?.sha256).toBe(sha256(first));
    expect((await taskRow(task.id)).status).toBe("applying");

    // Same turn: the runner still holds the `running` snapshot it started with.
    serveTemplate(second);
    await store.enqueueAgentToolCall({
      callId: "ready-2",
      request: { sha256: sha256(second) },
      task,
      toolName: "template_ready",
    });
    await processCalls(task, signals);

    const secondResult = await callRow(task.id, "ready-2");
    expect(secondResult.state).toBe("succeeded");
    expect(secondResult.errorCode).toBeNull();
    expect(secondResult.response?.decision).toBe("continue");
    expect(secondResult.response?.sha256).toBe(sha256(second));
    expect(secondResult.attempt).toBe(1);
    expect(beginApplyingCalls).toEqual([task.id]);
    const persisted = await taskRow(task.id);
    expect(persisted.status).toBe("applying");
    expect(persisted.agentTemplateDigest).toBe(sha256(second));
  });

  it("fails a contract violation on the first attempt without retrying", async () => {
    const task = await activeManagedTask("mcp-digest-mismatch");
    await store.enqueueAgentToolCall({
      callId: "ready-mismatch",
      request: { sha256: "a".repeat(64) },
      task,
      toolName: "template_ready",
    });

    await processCalls(task);

    const result = await callRow(task.id, "ready-mismatch");
    expect(result.state).toBe("failed");
    expect(result.errorCode).toBe("template_digest_mismatch");
    expect(result.attempt).toBe(1);
    expect(devboxExecCalls).toBe(1);
  });

  it("fails a malformed deployment_completed request once with a safe code", async () => {
    const task = await activeManagedTask("mcp-invalid-request");
    await store.enqueueAgentToolCall({
      callId: "completed-invalid",
      request: { workloads: "not-a-list", extra: "s3cret-value" },
      task,
      toolName: "deployment_completed",
    });

    await processCalls(task, {
      templateReady: {
        awaitingUser: false,
        blockingInputs: [],
        checkpointId: "checkpoint",
      },
    });

    const result = await callRow(task.id, "completed-invalid");
    expect(result.state).toBe("failed");
    expect(result.errorCode).toBe("invalid_request");
    expect(result.attempt).toBe(1);
  });

  it("exhausts transient failures with the last safe error code", async () => {
    const task = await activeManagedTask("mcp-transient-exhausted");
    const yaml = templateYaml("v1");
    devboxExecImpl = () =>
      Promise.reject(new Error("exec failed: token=provider-secret-value"));
    await store.enqueueAgentToolCall({
      callId: "ready-transient",
      request: { sha256: sha256(yaml) },
      task,
      toolName: "template_ready",
    });

    await processCalls(task);

    const result = await callRow(task.id, "ready-transient");
    expect(result.state).toBe("failed");
    expect(result.errorCode).toBe("claim_exhausted:agent_tool_failed");
    expect(result.errorCode).not.toContain("provider-secret-value");
    expect(result.attempt).toBe(3);
    // The exhausting claim never runs the handler again.
    expect(devboxExecCalls).toBe(2);
  });

  it("rethrows a superseded run instead of failing the call", async () => {
    const task = await activeManagedTask("mcp-superseded");
    const yaml = templateYaml("v1");
    devboxExecImpl = () => Promise.reject(new DeployTaskRunSupersededError());
    await store.enqueueAgentToolCall({
      callId: "ready-superseded",
      request: { sha256: sha256(yaml) },
      task,
      toolName: "template_ready",
    });

    await expect(processCalls(task)).rejects.toBeInstanceOf(
      DeployTaskRunSupersededError
    );

    const result = await callRow(task.id, "ready-superseded");
    expect(result.state).toBe("running");
    expect(result.attempt).toBe(1);
    expect(result.errorCode).toBeNull();
  });
});
