"use client";

import { appTokenRequestHeaders } from "@/lib/app-token-header";
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
  appToken,
  encodedKubeconfig,
  input,
}: {
  appToken: string;
  encodedKubeconfig: string;
  input: DeploymentTaskCreateInput;
}): Promise<DeploymentTaskCreateResult> {
  // Only GitHub-source creation is a personal-resource authorization point
  // (ADR-0059): the server resolves the Deployment Credential Binding from
  // the token-proven initiator's uid-keyed connection. Namespace-shared
  // sources never carry the token.
  const response = await fetch("/api/deploy-tasks", {
    body: JSON.stringify({
      ...input,
      encodedKubeconfig,
    }),
    headers: {
      "Content-Type": "application/json",
      ...(input.source.kind === "github"
        ? appTokenRequestHeaders(appToken)
        : {}),
    },
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
  appToken,
  kubeconfig,
}: {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}): DeploymentTargetPipelineAdapters {
  return {
    createDeploymentTask: (input) =>
      createDeploymentTaskFromApi({
        appToken,
        encodedKubeconfig: encodeURIComponent(kubeconfig),
        input,
      }),
  };
}
