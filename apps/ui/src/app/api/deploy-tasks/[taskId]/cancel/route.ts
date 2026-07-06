import { NextResponse } from "next/server";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { cancelDeployTaskAction } from "@/lib/deploy-task/engine/actions";
import { getDeployTaskEngineContext } from "@/lib/deploy-task/engine/server";
import { getDeployTaskById, toDeployTaskDTO } from "@/lib/deploy-task/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Two-phase cancel under the idempotency rule (ADR 0038): parked tasks
 * cancel immediately, leased tasks resolve to "cancelling" while the runner
 * acknowledges, a repeat is success, and a finished task is a conflict
 * carrying the snapshot.
 */
export async function POST(request: Request, context: RouteContext) {
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

  const existing = await getDeployTaskById(taskId);
  if (existing == null || existing.namespace !== namespaceResolved.namespace) {
    return jsonError("Deploy task not found", 404);
  }

  const result = await cancelDeployTaskAction(getDeployTaskEngineContext(), {
    taskId,
  });
  switch (result.kind) {
    case "not-found":
      return jsonError("Deploy task not found", 404);
    case "cancelled":
    case "cancelling":
      return NextResponse.json({ task: toDeployTaskDTO(result.task) });
    case "already-terminal":
      return NextResponse.json(
        {
          error: `Deploy task already ${result.task.status}.`,
          task: toDeployTaskDTO(result.task),
        },
        { status: 409 }
      );
    default:
      return result satisfies never;
  }
}
