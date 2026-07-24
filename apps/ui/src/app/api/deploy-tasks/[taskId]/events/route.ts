import { NextResponse } from "next/server";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/features/deploy/task/api-auth";
import {
  getCodexGatewayContextFromDevboxInfo,
  getCodexGatewayEventStreamUrl,
  persistDeployGatewayEvent,
  safeGatewaySessionIdentifier,
} from "@/features/deploy/task/gateway";
import {
  getDeployTaskByIdInNamespace,
  getDeployTaskSnapshot,
} from "@/features/deploy/task/service";
import { getDevbox } from "@/lib/devbox/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SSE_LINE_SEPARATOR_REGEX = /\r?\n/;
const SSE_BLOCK_SEPARATOR_REGEX = /\r?\n\r?\n/;
const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function parseSseBlock(block: string): {
  dataText: string;
  eventName: string;
} | null {
  if (!block.trim()) {
    return null;
  }

  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of block.split(SSE_LINE_SEPARATOR_REGEX)) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return { dataText: dataLines.join("\n"), eventName };
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveGatewayContext(input: {
  namespace: string;
  runtimeName: string | null;
}) {
  if (input.runtimeName == null) {
    return null;
  }

  try {
    const info = (await getDevbox(input.namespace, input.runtimeName)).data;
    return getCodexGatewayContextFromDevboxInfo(info);
  } catch (error) {
    console.error("[deploy-tasks] failed to resolve gateway context:", error);
    return null;
  }
}

async function persistAndForwardSseBlock(input: {
  block: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  taskId: string;
}): Promise<void> {
  const parsed = parseSseBlock(input.block);
  if (parsed?.dataText) {
    try {
      await persistDeployGatewayEvent({
        eventName: parsed.eventName,
        payload: JSON.parse(parsed.dataText) as Record<string, unknown>,
        taskId: input.taskId,
      });
    } catch (error) {
      console.error("[deploy-tasks] failed to persist gateway event:", error);
    }
  }
  // Gateway payloads may contain repository output, command errors, or
  // credentials. The browser only needs an invalidation signal; task state is
  // projected through the scrubbed snapshot/timeline APIs.
  input.controller.enqueue(
    input.encoder.encode(encodeSse("gateway-update", {}))
  );
}

async function flushSseBlocks(input: {
  buffer: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  taskId: string;
}): Promise<string> {
  let buffer = input.buffer;

  while (true) {
    const separatorMatch = buffer.match(SSE_BLOCK_SEPARATOR_REGEX);
    if (separatorMatch?.index == null) {
      return buffer;
    }

    const block = buffer.slice(0, separatorMatch.index);
    buffer = buffer.slice(separatorMatch.index + separatorMatch[0].length);
    await persistAndForwardSseBlock({ ...input, block });
  }
}

export async function GET(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const params = deployTaskRequestParams(request);
  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    clientNamespace: params.namespace,
    encodedKubeconfig: params.encodedKubeconfig,
  });
  if (!namespaceResolved.ok) {
    return jsonError(
      namespaceResolved.message ?? "Invalid deploy task namespace",
      namespaceResolved.status ?? 400
    );
  }
  if (namespaceResolved.namespace == null) {
    return jsonError("Invalid deploy task namespace", 400);
  }

  const rawTask = await getDeployTaskByIdInNamespace(
    taskId,
    namespaceResolved.namespace
  );
  if (rawTask == null) {
    return jsonError("Deploy task not found", 404);
  }
  const snapshot = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }

  const encoder = new TextEncoder();
  const gatewayContext = await resolveGatewayContext({
    namespace: namespaceResolved.namespace,
    runtimeName: rawTask.runtimeName,
  });
  const gatewaySessionId =
    rawTask.runner.kind === "ai"
      ? safeGatewaySessionIdentifier(rawTask.gatewaySessionId)
      : null;

  if (gatewayContext != null && gatewaySessionId != null) {
    const upstream = await fetch(
      getCodexGatewayEventStreamUrl(gatewayContext, gatewaySessionId),
      {
        cache: "no-store",
        headers: { accept: "text/event-stream" },
      }
    );

    if (upstream.ok && upstream.body != null) {
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();
      const heartbeat = encoder.encode(": ping\n\n");
      let sseBuffer = "";

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(encodeSse("snapshot", snapshot)));
          let closed = false;
          const heartbeatTimer = setInterval(() => {
            if (closed || sseBuffer.trim()) {
              return;
            }
            try {
              controller.enqueue(heartbeat);
            } catch {
              // Ignore enqueue errors after stream shutdown.
            }
          }, STREAM_HEARTBEAT_INTERVAL_MS);

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              if (value == null) {
                continue;
              }
              sseBuffer += decoder.decode(value, { stream: true });
              sseBuffer = await flushSseBlocks({
                buffer: sseBuffer,
                controller,
                encoder,
                taskId,
              });
            }
            sseBuffer += decoder.decode();
            sseBuffer = await flushSseBlocks({
              buffer: sseBuffer,
              controller,
              encoder,
              taskId,
            });
            closed = true;
            controller.close();
          } catch (error) {
            console.error("[deploy-tasks] gateway event stream failed:", error);
            closed = true;
            controller.close();
          } finally {
            closed = true;
            clearInterval(heartbeatTimer);
            reader.releaseLock();
          }
        },
        async cancel() {
          await reader.cancel();
        },
      });

      return new Response(stream, {
        headers: {
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      });
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeSse("snapshot", snapshot)));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
