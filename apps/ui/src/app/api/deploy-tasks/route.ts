import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deployTaskRequestParams,
  resolveDeployTaskRequestNamespace,
} from "@/lib/deploy-task/api-auth";
import { createDeployTaskAction } from "@/lib/deploy-task/engine/actions";
import { getDeployTaskEngineContext } from "@/lib/deploy-task/engine/server";
import {
  resolveDeploymentTaskTarget,
  runDeployTask,
} from "@/lib/deploy-task/runner";
import {
  getDeployTaskByIdInNamespace,
  listDeploymentTaskProjections,
  listDeployTasks,
  toDeployTaskDTO,
} from "@/lib/deploy-task/service";
import {
  createDeployTaskInputSchema,
  deployTaskStatusSchema,
} from "@/lib/deploy-task/types";
import { getGithubConnectionForNamespaceById } from "@/lib/github-app/connection-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = createDeployTaskInputSchema
  .omit({ createdFrom: true })
  .partial({ runner: true, source: true, target: true })
  .extend({
    encodedKubeconfig: z.string().optional(),
    /** Redeploy: clone this failed/cancelled predecessor (ADR 0038). */
    predecessorTaskId: z.string().trim().min(1).max(128).optional(),
  })
  .refine(
    (value) =>
      value.predecessorTaskId != null ||
      (value.runner != null && value.source != null && value.target != null),
    { message: "source, target, and runner are required without a predecessor" }
  );

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

  if (url.searchParams.get("view") === "tasks") {
    const statusParams = url.searchParams
      .getAll("status")
      .flatMap((value) => value.split(","))
      .map((value) => value.trim())
      .filter((value) => value !== "");
    const statuses = statusParams.flatMap((value) => {
      const parsed = deployTaskStatusSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    if (statuses.length !== statusParams.length) {
      return jsonError("Invalid deploy task status filter", 400);
    }
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam == null ? undefined : Number(limitParam);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return jsonError("Invalid deploy task list limit", 400);
    }
    const result = await listDeployTasks({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
      namespace: namespaceResolved.namespace,
      projectId: url.searchParams.get("projectId")?.trim() || undefined,
      status: statuses.length === 0 ? undefined : statuses,
    });
    return NextResponse.json(result);
  }

  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) {
    return NextResponse.json({ projections: [] });
  }
  const projections = await listDeploymentTaskProjections({
    namespace: namespaceResolved.namespace,
    projectId,
  });
  return NextResponse.json({ projections });
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
  const taskNamespace = namespaceResolved.namespace ?? parsed.data.namespace;
  if (parsed.data.predecessorTaskId != null) {
    const predecessor = await getDeployTaskByIdInNamespace(
      parsed.data.predecessorTaskId,
      taskNamespace
    );
    if (predecessor == null) {
      return jsonError("Deploy task predecessor not found", 404);
    }
  }
  if (parsed.data.source?.kind === "github") {
    const actorUserId = parsed.data.actorUserId?.trim();
    if (!actorUserId) {
      return jsonError("Actor user ID is required for GitHub deployment.", 400);
    }
    const githubConnectionId = parsed.data.githubConnectionId?.trim();
    if (!githubConnectionId) {
      return jsonError(
        "GitHub connection ID is required for GitHub deployment.",
        400
      );
    }
    const connection = await getGithubConnectionForNamespaceById({
      connectionId: githubConnectionId,
      namespace: taskNamespace,
      userId: actorUserId,
    });
    if (connection == null) {
      return jsonError(
        "GitHub connection does not belong to this namespace.",
        403
      );
    }
  }

  const { encodedKubeconfig, predecessorTaskId, ...taskInput } = parsed.data;
  const result = await createDeployTaskAction(getDeployTaskEngineContext(), {
    create: {
      ...taskInput,
      createdFrom: "ui",
      namespace: taskNamespace,
    },
    predecessorTaskId,
    resolveTarget: async (resolveInput) => {
      const resolved = await resolveDeploymentTaskTarget({
        id: "",
        namespace: resolveInput.namespace,
        projectId: null,
        projectName: null,
        target: resolveInput.target,
      });
      return {
        projectId: resolved.projectId,
        projectName: resolved.projectName,
      };
    },
    run: (handle, task) =>
      runDeployTask(handle, {
        encodedKubeconfig,
        // Full template args from the request body: the engine persists a
        // stripped copy, so sensitive values reach the runner only through
        // this in-memory hand-off (ADR 0037).
        sourceArgValues:
          parsed.data.source?.kind === "template"
            ? parsed.data.source.args
            : undefined,
        taskId: task.id,
      }),
  });

  switch (result.kind) {
    case "created":
      return NextResponse.json(
        { task: toDeployTaskDTO(result.task) },
        { status: 201 }
      );
    case "invalid":
      return jsonError(result.message, 400);
    case "predecessor-not-found":
      return jsonError("Deploy task predecessor not found", 404);
    case "predecessor-conflict":
      return NextResponse.json(
        {
          error: "Deploy task predecessor is not failed or cancelled.",
          task: toDeployTaskDTO(result.predecessor),
        },
        { status: 409 }
      );
    case "clone-conflict":
      return NextResponse.json(
        {
          error: "A recovery attempt for this deployment is already active.",
          ...(result.activeClone == null
            ? {}
            : { task: toDeployTaskDTO(result.activeClone) }),
        },
        { status: 409 }
      );
    default:
      return result satisfies never;
  }
}
