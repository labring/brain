import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveDeployTaskRequestNamespace } from "@/features/deploy/task/api-auth";
import type { DeployBillingActor } from "@/features/deploy/task/billing-failure-judgment";
import { submitDeployTaskInputAction } from "@/features/deploy/task/engine/actions";
import { getDeployTaskEngineContext } from "@/features/deploy/task/engine/server";
import { runDeployTask } from "@/features/deploy/task/runner";
import {
  getDeployTaskByIdInNamespace,
  getDeployTaskSnapshot,
  toDeployTaskDTO,
} from "@/features/deploy/task/service";
import { submitDeployTaskInputSchema } from "@/features/deploy/task/types";
import { appTokenFromRequest } from "@/lib/app-token";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

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
 * Best-effort account identity for the resumed run's billing reverse-check
 * (design spec E1/E2): a submission without a verifiable app token still
 * resumes, its failure just keeps the runner's own classification.
 */
async function billingActorFor(
  request: Request,
  input: { encodedKubeconfig?: string; namespace: string }
): Promise<DeployBillingActor | undefined> {
  const appToken = appTokenFromRequest(request);
  if (appToken.trim() === "") {
    return undefined;
  }
  const authorization = await authorizeWorkspaceActor({
    appToken,
    encodedKubeconfig: input.encodedKubeconfig,
    expectedNamespace: input.namespace,
  });
  if (!authorization.ok) {
    return undefined;
  }
  return {
    cookieHeader: request.headers.get("cookie"),
    userId: authorization.actorBinding.userId,
    userUid: authorization.actorBinding.userUid,
  };
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
  const billingActor = await billingActorFor(request, {
    encodedKubeconfig: parsed.data.encodedKubeconfig,
    namespace: namespaceResolved.namespace,
  });
  const result = await submitDeployTaskInputAction(
    getDeployTaskEngineContext(),
    {
      actionActor: namespaceResolved.workspaceActor,
      namespace: namespaceResolved.namespace,
      run: (handle, task, currentBlockingInputs, values) =>
        runDeployTask(handle, {
          ...(billingActor == null ? {} : { billingActor }),
          currentBlockingInputs,
          encodedKubeconfig: parsed.data.encodedKubeconfig,
          submittedInputValues: values,
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
    case "invalid-input":
      return NextResponse.json(
        {
          error: result.message,
          task: toDeployTaskDTO(result.task),
        },
        { status: 400 }
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
