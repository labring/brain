"use client";

import { randomName } from "@workspace/ui/lib/random-name";
import { applyBrainProductManifest } from "@/features/project-canvas/k8s/http/apply-yaml";
import { childResourceName } from "@/lib/project-child-resource-name";
import type {
  DeploymentTargetPipelineAdapters,
  GithubDeployTaskInput,
  GithubDeployTaskResult,
} from "./pipeline";

function deployTaskSuccessMessage(body: unknown): string {
  if (body == null || typeof body !== "object" || !("task" in body)) {
    return "Deploy task queued.";
  }
  const task = (body as { task?: { id?: unknown } }).task;
  return typeof task?.id === "string" && task.id !== ""
    ? `Deploy task ${task.id} queued.`
    : "Deploy task queued.";
}

function deployTaskId(body: unknown): string | null {
  if (body == null || typeof body !== "object" || !("task" in body)) {
    return null;
  }
  const task = (body as { task?: { id?: unknown } }).task;
  return typeof task?.id === "string" && task.id !== "" ? task.id : null;
}

function deployTaskErrorMessage(body: unknown): string {
  if (body != null && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error !== "") {
      return error;
    }
  }
  return "Could not create deploy task.";
}

export async function createGithubDeployTaskFromApi({
  encodedKubeconfig,
  input,
}: {
  encodedKubeconfig: string;
  input: GithubDeployTaskInput;
}): Promise<GithubDeployTaskResult> {
  const response = await fetch("/api/deploy-tasks", {
    body: JSON.stringify({
      encodedKubeconfig,
      namespace: input.namespace,
      projectName: input.projectName,
      projectUid: input.projectUid,
      repo: input.repo,
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
    taskId: deployTaskId(body),
  };
}

export function createDeploymentTargetClientAdapters({
  kubeconfig,
}: {
  kubeconfig: string;
  namespace: string;
}): DeploymentTargetPipelineAdapters {
  return {
    applyBrainProductManifest: (yaml) =>
      applyBrainProductManifest(kubeconfig, yaml),
    createProject: async (input) => {
      const response = await fetch("/api/projects", {
        body: JSON.stringify({
          displayName: input.displayName,
          namespace: input.namespace,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          body != null &&
          typeof body === "object" &&
          "error" in body &&
          typeof body.error === "string"
            ? body.error
            : "Could not create project.";
        throw new Error(message);
      }
      const project =
        body != null && typeof body === "object" && "project" in body
          ? (body.project as { id?: unknown })
          : null;
      if (typeof project?.id !== "string" || project.id.trim() === "") {
        throw new Error("Project API did not return a project id.");
      }
      return { id: project.id.trim() };
    },
    createGithubDeployTask: (input) =>
      createGithubDeployTaskFromApi({
        encodedKubeconfig: encodeURIComponent(kubeconfig),
        input,
      }),
    fetchProjectUidByName: (name) => Promise.resolve(name.trim() || undefined),
    generateChildResourceName: childResourceName,
    generateProjectName: randomName,
  };
}
