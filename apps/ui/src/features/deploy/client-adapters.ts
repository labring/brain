"use client";

import type {
  DeploymentTargetPipelineAdapters,
  DeploymentTaskCreateInput,
  DeploymentTaskCreateResult,
} from "./pipeline";

function deployTaskSuccessMessage(body: unknown): string {
  if (body == null || typeof body !== "object" || !("task" in body)) {
    return "Deployment task queued.";
  }
  const task = (body as { task?: { id?: unknown } }).task;
  return typeof task?.id === "string" && task.id !== ""
    ? `Deployment task ${task.id} queued.`
    : "Deployment task queued.";
}

function deployTaskResult(
  body: unknown
): Omit<DeploymentTaskCreateResult, "message"> {
  if (body == null || typeof body !== "object" || !("task" in body)) {
    return {
      projectId: null,
      projectName: null,
      taskId: null,
    };
  }
  const task = (
    body as {
      task?: {
        id?: unknown;
        projectId?: unknown;
        projectName?: unknown;
      };
    }
  ).task;
  return {
    projectId:
      typeof task?.projectId === "string" && task.projectId !== ""
        ? task.projectId
        : null,
    projectName:
      typeof task?.projectName === "string" && task.projectName !== ""
        ? task.projectName
        : null,
    taskId: typeof task?.id === "string" && task.id !== "" ? task.id : null,
  };
}

function deployTaskErrorMessage(body: unknown): string {
  if (body != null && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error !== "") {
      return error;
    }
  }
  return "Could not create deployment task.";
}

export async function createDeploymentTaskFromApi({
  encodedKubeconfig,
  input,
}: {
  encodedKubeconfig: string;
  input: DeploymentTaskCreateInput;
}): Promise<DeploymentTaskCreateResult> {
  const response = await fetch("/api/deploy-tasks", {
    body: JSON.stringify({
      ...input,
      encodedKubeconfig,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(deployTaskErrorMessage(body));
  }
  return {
    message: deployTaskSuccessMessage(body),
    ...deployTaskResult(body),
  };
}

export function createDeploymentTargetClientAdapters({
  kubeconfig,
}: {
  kubeconfig: string;
  namespace: string;
}): DeploymentTargetPipelineAdapters {
  return {
    createDeploymentTask: (input) =>
      createDeploymentTaskFromApi({
        encodedKubeconfig: encodeURIComponent(kubeconfig),
        input,
      }),
  };
}
