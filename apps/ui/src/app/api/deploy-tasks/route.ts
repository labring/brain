import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import {
  resolveDeploymentTaskTarget,
  startDeployTaskRunner,
} from "@/lib/deploy-task/runner";
import { createDeployTask, listDeployTasks } from "@/lib/deploy-task/service";
import { createDeployTaskInputSchema } from "@/lib/deploy-task/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = createDeployTaskInputSchema.extend({
  encodedKubeconfig: z.string().optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
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
  const tasks = await listDeployTasks({
    namespace: namespaceResolved.namespace,
    ...(projectId ? { projectId } : {}),
  });
  return NextResponse.json({ tasks });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid deploy task request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const namespaceResolved = await resolveDeployTaskRequestNamespace({
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    clientNamespace: parsed.data.namespace,
  });
  if (!namespaceResolved.ok) {
    return jsonError(
      namespaceResolved.message ?? "Invalid deploy task namespace",
      namespaceResolved.status ?? 400
    );
  }

  const { encodedKubeconfig: _encodedKubeconfig, ...taskInput } = parsed.data;
  const task = await createDeployTask({
    ...taskInput,
    namespace: namespaceResolved.namespace ?? taskInput.namespace,
  });
  const resolved = await resolveDeploymentTaskTarget({
    ...task,
    namespace: namespaceResolved.namespace ?? task.namespace,
  });

  startDeployTaskRunner({
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    taskId: task.id,
  }).catch((error: unknown) => {
    console.error("[deploy-tasks] runner failed:", error);
  });

  return NextResponse.json(
    {
      task: {
        ...task,
        projectId: resolved.projectId,
        projectName: resolved.projectName,
        phase: "resolve-target",
        status: "running",
      },
    },
    { status: 201 }
  );
}
