import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { getDeployTaskTimelineSnapshot } from "@/lib/deploy-task/service";
import { subscribeDeploymentTaskTimelineEvents } from "@/lib/deploy-task/timeline-events";
import type { DeploymentTaskTimelineStreamEvent } from "@/lib/deploy-task/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

  const namespace = namespaceResolved.namespace;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let snapshotSent = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      const pendingEvents: DeploymentTaskTimelineStreamEvent[] = [];

      function cleanup() {
        if (closed) {
          return;
        }
        closed = true;
        if (heartbeatTimer !== undefined) {
          clearInterval(heartbeatTimer);
        }
        unsubscribe?.();
        request.signal.removeEventListener("abort", close);
      }

      function close() {
        cleanup();
        try {
          controller.close();
        } catch {
          // Ignore close errors after client disconnect.
        }
      }

      function write(chunk: string): boolean {
        if (closed) {
          return false;
        }
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          cleanup();
          return false;
        }
      }

      const send = (event: string, data: unknown): boolean =>
        write(encodeSse(event, data));

      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) {
        close();
        return;
      }

      unsubscribe = subscribeDeploymentTaskTimelineEvents({
        listener: (timelineSnapshot) => {
          const event: DeploymentTaskTimelineStreamEvent = {
            snapshot: timelineSnapshot,
            type: "update",
          };
          if (snapshotSent) {
            send(event.type, event);
            return;
          }
          pendingEvents.push(event);
        },
        namespace,
        taskId,
      });
      heartbeatTimer = setInterval(
        () => write(": ping\n\n"),
        STREAM_HEARTBEAT_INTERVAL_MS
      );

      try {
        const snapshot = await getDeployTaskTimelineSnapshot(taskId, namespace);
        if (closed) {
          return;
        }
        if (snapshot == null) {
          send("error", {
            message: "Deploy task not found",
            type: "error",
          });
          close();
          return;
        }
        send("snapshot", { snapshot, type: "snapshot" });
        snapshotSent = true;
        for (const event of pendingEvents) {
          if (!send(event.type, event)) {
            break;
          }
        }
        pendingEvents.length = 0;
      } catch (error) {
        send("error", {
          message:
            error instanceof Error
              ? error.message
              : "Could not load deployment task timeline.",
          type: "error",
        });
        close();
      }
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
