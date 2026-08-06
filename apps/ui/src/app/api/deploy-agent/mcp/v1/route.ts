import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import {
  enqueueAgentToolCall,
  findTaskForAgentCapability,
  waitForAgentToolCall,
} from "@/features/deploy/task/agent-tools/store";
import type {
  DeployTaskAgentCallResponse,
  DeployTaskRow,
} from "@/features/deploy/task/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const BEARER_CAPABILITY_PATTERN = /^Bearer ([A-Za-z0-9_-]{32,256})$/;

const templateReadyInputSchema = z
  .object({
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "sha256 must be a lowercase SHA-256 digest"),
  })
  .strict();

const templateReadyOutputSchema = z.object({
  decision: z.enum(["continue", "awaiting_user"]),
  checkpointId: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

const completedInputSchema = z.object({}).strict();
const completedOutputSchema = z.object({
  decision: z.enum(["accepted_stop", "repair"]),
  receiptId: z.string().min(1),
  findings: z.array(z.string()).optional(),
});

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim() ?? "";
  const match = BEARER_CAPABILITY_PATTERN.exec(value);
  return match?.[1] ?? null;
}

function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin == null) {
    return true;
  }
  const allowlist = (process.env.DEPLOY_AGENT_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowlist.includes(origin);
}

function textResponse(response: DeployTaskAgentCallResponse): {
  content: [{ text: string; type: "text" }];
  structuredContent: DeployTaskAgentCallResponse;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(response) }],
    structuredContent: response,
  };
}

function failedResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function callIdFor(
  task: DeployTaskRow,
  toolName: "template_ready" | "deployment_completed",
  requestId: string | number
): string {
  const session = task.gatewaySessionId ?? "unbound";
  return createHash("sha256")
    .update(
      `${session}:${task.leaseEpoch}:${toolName}:${String(requestId)}`,
      "utf8"
    )
    .digest("hex");
}

async function executeToolCall(input: {
  args: Record<string, unknown>;
  requestId: string | number;
  task: DeployTaskRow;
  toolName: "template_ready" | "deployment_completed";
  signal: AbortSignal;
}) {
  const row = await enqueueAgentToolCall({
    callId: callIdFor(input.task, input.toolName, input.requestId),
    request: input.args,
    task: input.task,
    toolName: input.toolName,
  });
  const result = await waitForAgentToolCall({
    callId: row.callId,
    signal: input.signal,
    taskId: row.taskId,
  });
  if (result.state === "failed") {
    return failedResponse(
      result.errorCode ?? "Deployment control call failed."
    );
  }
  return textResponse(result.response ?? {});
}

function createServer(task: DeployTaskRow): McpServer {
  const server = new McpServer({
    name: "sealai-deploy-control",
    version: "1.0.0",
  });

  server.registerTool(
    "template_ready",
    {
      title: "Template Ready",
      description:
        "Notify Brain that .sealos/template/index.yaml is ready. Brain reads the fixed artifact and derives the form.",
      inputSchema: templateReadyInputSchema,
      outputSchema: templateReadyOutputSchema,
      annotations: {
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async (args, extra) =>
      await executeToolCall({
        args,
        requestId: extra.requestId,
        signal: extra.signal,
        task,
        toolName: "template_ready",
      })
  );

  server.registerTool(
    "deployment_completed",
    {
      title: "Deployment Completed",
      description:
        "Notify Brain after the Codex deployment, runtime-truth checks and repair loop have passed.",
      inputSchema: completedInputSchema,
      outputSchema: completedOutputSchema,
      annotations: {
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: false,
      },
    },
    async (args, extra) =>
      await executeToolCall({
        args,
        requestId: extra.requestId,
        signal: extra.signal,
        task,
        toolName: "deployment_completed",
      })
  );

  return server;
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request)) {
    return Response.json({ error: "Origin is not allowed." }, { status: 403 });
  }
  const token = bearerToken(request);
  if (token == null) {
    return Response.json(
      { error: "Bearer capability is required." },
      { status: 401 }
    );
  }
  const task = await findTaskForAgentCapability(token);
  if (task == null) {
    return Response.json(
      { error: "Invalid or revoked deployment capability." },
      { status: 401 }
    );
  }

  const server = createServer(task);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    await server.close().catch(() => undefined);
    return response;
  } catch {
    await server.close().catch(() => undefined);
    return Response.json({ error: "MCP request failed." }, { status: 500 });
  }
}

export function GET(): Response {
  return Response.json(
    { error: "MCP endpoint is POST-only." },
    { status: 405 }
  );
}

export function DELETE(): Response {
  return Response.json(
    { error: "MCP endpoint is stateless." },
    { status: 405 }
  );
}
