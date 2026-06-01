"use client";

import { GithubDeployer } from "@workspace/ui/components/github-deployer/github-deployer";
import type {
  GithubDeployerRepo,
  GithubDeployerStates,
} from "@workspace/ui/components/github-deployer/github-deployer.types";
import { SidePane } from "@workspace/ui/components/side-pane";
import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { useGithubAuth } from "@/hooks/use-github-auth";
import { useGithubRepos } from "@/hooks/use-github-repos";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

const GITHUB_MARK_PATH =
  "M12 2c5.5228 0 10 4.47715 10 10 0 4.5716 -3.0686 8.4239 -7.2578 9.6162v-3.0117c0 -0.7275 -0.1595 -1.4465 -0.4678 -2.1055 2.1883 -0.7822 4.2783 -2.4447 4.2783 -4.4355 0 -1.2663 -0.4671 -2.75174 -1.5127 -3.63186V6l-2.9462 0.98828c-0.6589 -0.16036 -1.3628 -0.24706 -2.0938 -0.24707 -0.731 0 -1.4349 0.08673 -2.09375 0.24707L6.95996 6v2.43164c-1.04555 0.88009 -1.51163 2.36566 -1.51172 3.63186 0 1.9907 2.08913 3.6533 4.27735 4.4355 -0.26358 0.5635 -0.41862 1.1711 -0.45801 1.7901 -0.13854 0.0283 -0.25191 0.0415 -0.34473 0.04 -0.20756 -0.0033 -0.36606 -0.06 -0.51953 -0.1562 -1.11532 -0.7 -1.54401 -1.9835 -3.05566 -2.1543 -0.19076 -0.0214 -0.3474 0.1371 -0.34766 0.3291 0 0.1922 0.15921 0.3423 0.34473 0.3925 1.44216 0.39 1.42755 3.2266 3.54785 3.2598 0.11976 0.0019 0.24101 -0.0069 0.36426 -0.0186v1.6348C5.06807 20.4236 2 16.5713 2 12 2 6.47715 6.47715 2 12 2";

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

export function GitHubDeploymentPane({ onClose }: { onClose: () => void }) {
  const params = useParams<{ uid?: string }>();
  const projectUid = decodeURIComponent(params.uid ?? "").trim();
  const hasCurrentProject = projectUid !== "";
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const [deploying, setDeploying] = useState(false);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectUid,
  });

  const {
    initiateGithubAuth,
    isAuthorized,
    isLoading: authLoading,
  } = useGithubAuth();
  const {
    error: reposError,
    isLoading: reposLoading,
    mutate: mutateRepos,
    repos,
  } = useGithubRepos({ isAuthorized, namespace });

  const states: GithubDeployerStates = useMemo(
    () => ({
      deployedRepo: null,
      isAuthorized,
      isLoading: deploying || authLoading || (isAuthorized && reposLoading),
      repoError: reposError,
      repoRetry: () => {
        mutateRepos().catch(() => undefined);
      },
      repos,
    }),
    [
      authLoading,
      deploying,
      isAuthorized,
      mutateRepos,
      repos,
      reposError,
      reposLoading,
    ]
  );

  const handleDeploy = useCallback(
    async (repo: GithubDeployerRepo) => {
      if (kubeconfig.trim() === "" || namespace.trim() === "") {
        toast.error("Kubeconfig or namespace is missing.");
        return;
      }
      const fullName = repo.fullName?.trim();
      if (!fullName) {
        toast.error("Repository full name is missing.");
        return;
      }
      const repoUrl = repo.url?.trim() || `https://github.com/${fullName}`;

      setDeploying(true);
      try {
        const response = await fetch("/api/deploy-tasks", {
          body: JSON.stringify({
            encodedKubeconfig: encodeURIComponent(kubeconfig),
            namespace,
            projectName: currentProject.resourceName,
            projectUid: hasCurrentProject ? projectUid : undefined,
            repo: {
              fullName,
              id: repo.id,
              name: repo.name,
              url: repoUrl,
            },
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(deployTaskErrorMessage(body));
        }
        const taskId = deployTaskId(body);
        const projectName = currentProject.resourceName?.trim();
        if (taskId != null && projectName) {
          dispatchDeployTaskCreatedEvent({
            projectName,
            repoFullName: fullName,
            taskId,
          });
        }
        toast.success(deployTaskSuccessMessage(body));
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not create deploy task."
        );
      } finally {
        setDeploying(false);
      }
    },
    [
      currentProject.resourceName,
      hasCurrentProject,
      kubeconfig,
      namespace,
      onClose,
      projectUid,
    ]
  );

  const actions = useMemo(
    () => ({
      onAuthorize: initiateGithubAuth,
      onDeploy: handleDeploy,
    }),
    [handleDeploy, initiateGithubAuth]
  );

  return (
    <SidePane
      closeAriaLabel="Close GitHub deployment pane"
      icon={
        <svg
          aria-hidden
          className="size-4 text-foreground"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>GitHub</title>
          <path d={GITHUB_MARK_PATH} fill="currentColor" />
        </svg>
      }
      label="GitHub deployment pane"
      onClose={onClose}
      subtitle={
        hasCurrentProject
          ? "Deploy a repository into the current project."
          : "Create a new project from a repository."
      }
      title={hasCurrentProject ? "Deploy from GitHub" : "Create from GitHub"}
    >
      <div className="min-w-0" data-slot="github-deployment-pane">
        <GithubDeployer.Root actions={actions} states={states}>
          <GithubDeployer.Shell />
        </GithubDeployer.Root>
      </div>
    </SidePane>
  );
}
