import { NextResponse } from "next/server";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/features/deploy/task/api-auth";
import { withDeployTaskDevMock } from "@/features/deploy/task/dev-mock-route";
import { getDeployTaskTimelineSnapshot } from "@/features/deploy/task/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGet(request: Request, context: RouteContext) {
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
  const snapshot = await getDeployTaskTimelineSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshot == null) {
    return jsonError("Deploy task not found", 404);
  }
  return NextResponse.json(snapshot);
}

export const GET = withDeployTaskDevMock("timeline", handleGet, (context) =>
  context.params.then((params) => params.taskId)
);
