import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveDeployTaskRequestNamespace } from "@/lib/deploy-task/api-auth";
import { submitDeployTaskInputAction } from "@/lib/deploy-task/engine/actions";
import { getDeployTaskEngineContext } from "@/lib/deploy-task/engine/server";
import { runDeployTask } from "@/lib/deploy-task/runner";
import {
  getDeployTaskByIdInNamespace,
  getDeployTaskSnapshot,
  toDeployTaskDTO,
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

/**
 * Blocking Input submission performs the blocked → running claim itself and
 * hands the values to the resumed runner in process memory (ADR 0037);
 * values are never persisted.
 */
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

  const existing = await getDeployTaskByIdInNamespace(
    taskId,
    namespaceResolved.namespace
  );
  if (existing == null) {
    return jsonError("Deploy task not found", 404);
  }

  const submittedValues = parsed.data.values;
  const result = await submitDeployTaskInputAction(
    getDeployTaskEngineContext(),
    {
      namespace: namespaceResolved.namespace,
      run: (handle, task) =>
        runDeployTask(handle, {
          encodedKubeconfig: parsed.data.encodedKubeconfig,
          submittedInputValues: submittedValues,
          taskId: task.id,
        }),
      taskId,
      values: submittedValues,
    }
  );

  switch (result.kind) {
    case "not-found":
      return jsonError("Deploy task not found", 404);
    case "conflict":
      return NextResponse.json(
        {
          error: "Deploy task is not waiting for input",
          task: toDeployTaskDTO(result.task),
        },
        { status: 409 }
      );
    case "resumed": {
      const snapshot = await getDeployTaskSnapshot(
        taskId,
        namespaceResolved.namespace
      );
      return NextResponse.json(
        snapshot ?? { task: toDeployTaskDTO(result.task) }
      );
    }
    default:
      return result satisfies never;
  }
}
