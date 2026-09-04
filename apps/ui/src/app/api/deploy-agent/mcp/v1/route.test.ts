import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import type { DeployTaskRow } from "@/features/deploy/task/schema";

const requireModule = createRequire(import.meta.url);
const enqueued: Array<{ request: Record<string, unknown>; toolName: string }> =
  [];

mock.module("server-only", () => ({}));
mock.module("@/features/deploy/task/agent-tools/store", () => ({
  enqueueAgentToolCall: (input: {
    callId: string;
    request: Record<string, unknown>;
    task: DeployTaskRow;
    toolName: string;
  }) => {
    enqueued.push({ request: input.request, toolName: input.toolName });
    return Promise.resolve({ callId: input.callId, taskId: input.task.id });
  },
  findTaskForAgentCapability: () =>
    Promise.resolve({
      gatewaySessionId: "session-mcp-route",
      id: "task-mcp-route",
    } as DeployTaskRow),
  waitForAgentToolCall: (input: { callId: string; taskId: string }) =>
    Promise.resolve({
      callId: input.callId,
      response:
        enqueued.at(-1)?.toolName === "template_ready"
          ? {
              checkpointId: "checkpoint-route",
              decision: "continue",
              sha256: enqueued.at(-1)?.request.sha256,
            }
          : { decision: "accepted_stop", receiptId: "receipt-route" },
      state: "succeeded",
      taskId: input.taskId,
    }),
}));

const { POST } = requireModule("./route") as typeof import("./route");

function mcpRequest(body: Record<string, unknown>): Request {
  return new Request("https://brain.test/api/deploy-agent/mcp/v1", {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${"a".repeat(43)}`,
      "content-type": "application/json",
      "mcp-protocol-version": "2025-03-26",
    },
    method: "POST",
  });
}

beforeEach(() => {
  enqueued.length = 0;
});

describe("deployment control MCP route", () => {
  it("exposes only the two allowlisted control tools", async () => {
    const response = await POST(
      mcpRequest({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/list",
        params: {},
      })
    );
    const payload = (await response.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.tools?.map((tool) => tool.name).sort()).toEqual([
      "deployment_completed",
      "template_ready",
    ]);
  });

  it("rejects deployment_completed without workload references before persistence", async () => {
    const response = await POST(
      mcpRequest({
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {},
          name: "deployment_completed",
        },
      })
    );
    const payload = (await response.json()) as {
      result?: { isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(enqueued).toHaveLength(0);
  });

  it("persists actual workload references for deployment_completed", async () => {
    const response = await POST(
      mcpRequest({
        id: 4,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            workloads: [
              {
                apiVersion: "apps/v1",
                kind: "Deployment",
                name: "demo",
                namespace: "tenant-a",
              },
            ],
          },
          name: "deployment_completed",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(enqueued).toEqual([
      {
        request: {
          workloads: [
            {
              apiVersion: "apps/v1",
              kind: "Deployment",
              name: "demo",
              namespace: "tenant-a",
            },
          ],
        },
        toolName: "deployment_completed",
      },
    ]);
  });

  it("persists an optional publicUrl with deployment_completed", async () => {
    const response = await POST(
      mcpRequest({
        id: 5,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            publicUrl: "https://demo.tenant-a.sealos.io",
            workloads: [
              {
                apiVersion: "apps/v1",
                kind: "Deployment",
                name: "demo",
                namespace: "tenant-a",
              },
            ],
          },
          name: "deployment_completed",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(enqueued).toEqual([
      {
        request: {
          publicUrl: "https://demo.tenant-a.sealos.io",
          workloads: [
            {
              apiVersion: "apps/v1",
              kind: "Deployment",
              name: "demo",
              namespace: "tenant-a",
            },
          ],
        },
        toolName: "deployment_completed",
      },
    ]);
  });

  it("persists multiple typed access endpoints with deployment_completed", async () => {
    const accessEndpoints = [
      {
        id: "web-client",
        label: "Web client",
        url: "https://play.tenant-a.sealos.io",
      },
      {
        id: "game-server",
        label: "Game server",
        url: "wss://play.tenant-a.sealos.io/server",
      },
    ];
    const workloads = [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        name: "eaglercraft",
        namespace: "tenant-a",
      },
    ];

    const response = await POST(
      mcpRequest({
        id: 7,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { accessEndpoints, workloads },
          name: "deployment_completed",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(enqueued).toEqual([
      {
        request: { accessEndpoints, workloads },
        toolName: "deployment_completed",
      },
    ]);
  });

  it("rejects a non-http publicUrl before persistence", async () => {
    const response = await POST(
      mcpRequest({
        id: 6,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: {
            publicUrl: "ftp://demo.example",
            workloads: [
              {
                apiVersion: "apps/v1",
                kind: "Deployment",
                name: "demo",
                namespace: "tenant-a",
              },
            ],
          },
          name: "deployment_completed",
        },
      })
    );
    const payload = (await response.json()) as {
      result?: { isError?: boolean };
    };

    expect(response.status).toBe(200);
    expect(payload.result?.isError).toBe(true);
    expect(enqueued).toHaveLength(0);
  });

  it("persists only the strict template digest argument", async () => {
    const digest = "b".repeat(64);
    const response = await POST(
      mcpRequest({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { sha256: digest },
          name: "template_ready",
        },
      })
    );

    expect(response.status).toBe(200);
    expect(enqueued).toEqual([
      { request: { sha256: digest }, toolName: "template_ready" },
    ]);
  });
});
