import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { subscribeDeploymentTaskProjectionEvents } from "@/lib/deploy-task/projection-events";
import { listDeploymentTaskProjections } from "@/lib/deploy-task/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STREAM_HEARTBEAT_INTERVAL_MS = 10_000;

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
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
      const pendingEvents: unknown[] = [];
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeSse(event, data)));
        } catch {
          closed = true;
        }
      };

      const unsubscribe = subscribeDeploymentTaskProjectionEvents({
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
      const heartbeatTimer = setInterval(() => {
        if (closed) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, STREAM_HEARTBEAT_INTERVAL_MS);

      try {
        const projections = await listDeploymentTaskProjections({
          namespace,
          projectId,
        });
        send("snapshot", { projections, type: "snapshot" });
        snapshotSent = true;
        for (const event of pendingEvents) {
          if (
            event != null &&
            typeof event === "object" &&
            "type" in event &&
            typeof event.type === "string"
          ) {
            send(event.type, event);
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
      }

      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
          clearInterval(heartbeatTimer);
          unsubscribe();
          try {
            controller.close();
          } catch {
            // Ignore close errors after client disconnect.
          }
        },
        { once: true }
      );
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
