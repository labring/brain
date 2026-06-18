import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveDeployTaskRequestNamespace } from "@/lib/deploy-task/api-auth";
import { startDeployTaskRunner } from "@/lib/deploy-task/runner";
import {
  getDeployTaskSnapshot,
  submitDeployTaskInput,
} from "@/lib/deploy-task/service";
import { submitDeployTaskInputSchema } from "@/lib/deploy-task/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ taskId: string }>;
}

const requestSchema = submitDeployTaskInputSchema.extend({
  encodedKubeconfig: z.string().optional(),
  namespace: z.string().optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, context: RouteContext) {
  const { taskId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deploy task input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    clientNamespace: parsed.data.namespace,
    encodedKubeconfig: parsed.data.encodedKubeconfig,
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

  const snapshotBeforeInput = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  if (snapshotBeforeInput == null) {
    return jsonError("Deploy task not found", 404);
  }

  const task = await submitDeployTaskInput(taskId, {
    values: parsed.data.values,
  });
  if (task == null) {
    return jsonError("Deploy task not found", 404);
  }
  startDeployTaskRunner({
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    submittedInputValues: parsed.data.values,
    taskId,
  }).catch((error: unknown) => {
    console.error("[deploy-tasks] runner input resume failed:", error);
  });
  const snapshot = await getDeployTaskSnapshot(
    taskId,
    namespaceResolved.namespace
  );
  return NextResponse.json(snapshot ?? { task });
}
