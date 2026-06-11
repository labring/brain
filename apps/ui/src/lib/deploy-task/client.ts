"use client";

import type {
  DeployTaskDTO,
  UpdateDeployTaskCanvasProjectionInput,
} from "./types";

export const DEPLOY_TASKS_API_PATH = "/api/deploy-tasks";

function errorMessageFromBody(body: unknown): string | undefined {
  if (body == null || typeof body !== "object" || !("error" in body)) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.trim() !== "" ? error : undefined;
}

async function jsonOrError<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Deploy task request failed (${response.status}).`;
    const body = await response.json().catch(() => undefined);
    throw new Error(errorMessageFromBody(body) ?? fallback);
  }
  return (await response.json()) as T;
}

export async function fetchProjectDeployTasks(input: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<DeployTaskDTO[]> {
  const url = new URL(DEPLOY_TASKS_API_PATH, window.location.origin);
  url.searchParams.set(
    "encodedKubeconfig",
    encodeURIComponent(input.kubeconfig)
  );
  url.searchParams.set("namespace", input.namespace);
  url.searchParams.set("projectId", input.projectId);
  const body = await jsonOrError<{ tasks?: DeployTaskDTO[] }>(
    await fetch(url, {
      cache: "no-store",
      method: "GET",
    })
  );
  return Array.isArray(body.tasks) ? body.tasks : [];
}

export async function patchDeployTaskCanvasProjection(input: {
  kubeconfig: string;
  namespace: string;
  taskId: string;
  update: UpdateDeployTaskCanvasProjectionInput;
}): Promise<DeployTaskDTO> {
  const url = new URL(
    `${DEPLOY_TASKS_API_PATH}/${encodeURIComponent(input.taskId)}`,
    window.location.origin
  );
  url.searchParams.set(
    "encodedKubeconfig",
    encodeURIComponent(input.kubeconfig)
  );
  url.searchParams.set("namespace", input.namespace);
  const body = await jsonOrError<{ task?: DeployTaskDTO }>(
    await fetch(url, {
      body: JSON.stringify(input.update),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    })
  );
  if (body.task == null) {
    throw new Error("Deploy task response did not include a task.");
  }
  return body.task;
}
