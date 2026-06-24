import { NextResponse } from "next/server";

import { decodeKubeconfig } from "@/lib/chat-runtime/kubeconfig";
import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { getDeployTaskTimelineSnapshot } from "@/lib/deploy-task/service";

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
  const kubeconfig = decodeKubeconfig(params.encodedKubeconfig);

  const snapshot = await getDeployTaskTimelineSnapshot(
    taskId,
    namespaceResolved.namespace,
    { kubeconfig: kubeconfig ?? undefined }
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }
  return NextResponse.json(snapshot);
}
