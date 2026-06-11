import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { startDeployTaskRunner } from "@/lib/deploy-task/runner";
import {
  getDeployTaskSnapshot,
  recordDeployTaskEvent,
  updateDeployTaskState,
} from "@/lib/deploy-task/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

const requestSchema = z.object({}).optional();
const bodySchema = z
  .object({
    encodedKubeconfig: z.string().optional(),
  })
  .optional();

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const params = deployTaskRequestParams(request);
  const body = await request.json().catch(() => undefined);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid deploy task retry request",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const parsedBody = bodySchema.safeParse(body);
  const encodedKubeconfig = parsedBody.success
    ? (parsedBody.data?.encodedKubeconfig ?? params.encodedKubeconfig)
    : params.encodedKubeconfig;

  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    clientNamespace: params.namespace,
    encodedKubeconfig,
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
  if (
    snapshot.task.status !== "failed" &&
    snapshot.task.status !== "blocked" &&
    snapshot.task.status !== "cancelled"
  ) {
    return jsonError("Deploy task is already active", 409);
  }

  await updateDeployTaskState(taskId, {
    error: null,
    phase: "queued",
    status: "queued",
  });
  await recordDeployTaskEvent(taskId, {
    kind: "deploy_task.retry_requested",
    message: "Deploy task retry requested.",
    phase: "queued",
  });

  startDeployTaskRunner({
    encodedKubeconfig,
    taskId,
  }).catch((error: unknown) => {
    console.error("[deploy-tasks] runner retry failed:", error);
  });

  const updated = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  return NextResponse.json(updated);
}
