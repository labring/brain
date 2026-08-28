import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/features/deploy/task/api-auth";
import { withDeployTaskDevMock } from "@/features/deploy/task/dev-mock-route";
import type { DeploymentTaskProjectionStreamEvent } from "@/features/deploy/task/projection";
import {
  type DeploymentTaskEventsSubscription,
  subscribeDeploymentTaskProjectionEvents,
} from "@/features/deploy/task/projection-events";
import { listDeploymentTaskProjections } from "@/features/deploy/task/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function handleGet(request: Request) {
  const url = new URL(request.url);
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

  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return jsonError("Project ID is required.", 400);
  }

  const namespace = namespaceResolved.namespace;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let snapshotSent = false;
      let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
      let subscription: DeploymentTaskEventsSubscription | undefined;
      const pendingEvents: DeploymentTaskProjectionStreamEvent[] = [];

      function cleanup() {
        if (closed) {
          return;
        }
        closed = true;
        if (heartbeatTimer !== undefined) {
          clearInterval(heartbeatTimer);
        }
        subscription?.unsubscribe();
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

      subscription = subscribeDeploymentTaskProjectionEvents({
        listProjections: () =>
          listDeploymentTaskProjections({ namespace, projectId }),
        listener: (event) => {
          if (snapshotSent) {
            send(event.type, event);
            return;
          }
          pendingEvents.push(event);
        },
        namespace,
        projectId,
      });
      heartbeatTimer = setInterval(
        () => write(": ping\n\n"),
        STREAM_HEARTBEAT_INTERVAL_MS
      );

      try {
        // Subscribe-before-bootstrap (ADR 0037): the bootstrap read waits
        // for LISTEN so no update falls between snapshot and subscription.
        await subscription.ready;
        const projections = await listDeploymentTaskProjections({
          namespace,
          projectId,
        });
        if (closed) {
          return;
        }
        send("snapshot", { projections, type: "snapshot" });
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
              : "Could not load deployment task projections.",
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

export const GET = withDeployTaskDevMock("projections-stream", handleGet);
