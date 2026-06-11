import { NextResponse } from "next/server";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import {
  cancelDeployTask,
  getDeployTaskSnapshot,
  updateDeployTaskCanvasProjection,
} from "@/lib/deploy-task/service";
import { updateDeployTaskCanvasProjectionInputSchema } from "@/lib/deploy-task/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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
  const snapshot = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }
  return NextResponse.json(snapshot);
}

export async function DELETE(request: Request, context: RouteContext) {
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
  const snapshot = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }
  const task = await cancelDeployTask(taskId);
  if (task == null) {
    return jsonError("Deploy task not found", 404);
  }
  return NextResponse.json({ task });
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const body = await request.json().catch(() => null);
  const parsed = updateDeployTaskCanvasProjectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        details: parsed.error.flatten(),
        error: "Invalid deploy task projection request",
      },
      { status: 400 }
    );
  }

  const snapshot = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }
  const task = await updateDeployTaskCanvasProjection(taskId, parsed.data);
  if (task == null) {
    return jsonError("Deploy task not found", 404);
  }
  return NextResponse.json({ task });
}
