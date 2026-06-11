"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { GithubDeployer } from "@/features/deployment/github-deployer/github-deployer";
import type {
  GithubDeployerRepo,
  GithubDeployerStates,
} from "@/features/deployment/github-deployer/github-deployer.types";

import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { useGithubAuth } from "@/hooks/use-github-auth";
import { useGithubRepos } from "@/hooks/use-github-repos";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";

const GITHUB_MARK_PATH =
  "M12 2c5.5228 0 10 4.47715 10 10 0 4.5716 -3.0686 8.4239 -7.2578 9.6162v-3.0117c0 -0.7275 -0.1595 -1.4465 -0.4678 -2.1055 2.1883 -0.7822 4.2783 -2.4447 4.2783 -4.4355 0 -1.2663 -0.4671 -2.75174 -1.5127 -3.63186V6l-2.9462 0.98828c-0.6589 -0.16036 -1.3628 -0.24706 -2.0938 -0.24707 -0.731 0 -1.4349 0.08673 -2.09375 0.24707L6.95996 6v2.43164c-1.04555 0.88009 -1.51163 2.36566 -1.51172 3.63186 0 1.9907 2.08913 3.6533 4.27735 4.4355 -0.26358 0.5635 -0.41862 1.1711 -0.45801 1.7901 -0.13854 0.0283 -0.25191 0.0415 -0.34473 0.04 -0.20756 -0.0033 -0.36606 -0.06 -0.51953 -0.1562 -1.11532 -0.7 -1.54401 -1.9835 -3.05566 -2.1543 -0.19076 -0.0214 -0.3474 0.1371 -0.34766 0.3291 0 0.1922 0.15921 0.3423 0.34473 0.3925 1.44216 0.39 1.42755 3.2266 3.54785 3.2598 0.11976 0.0019 0.24101 -0.0069 0.36426 -0.0186v1.6348C5.06807 20.4236 2 16.5713 2 12 2 6.47715 6.47715 2 12 2";

export function GitHubDeploymentPane({
  kubeconfig,
  namespace,
  onClose,
  projectId,
}: {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  projectId: string;
}) {
  const projectIdTrimmed = projectId.trim();
  const hasCurrentProject = projectIdTrimmed !== "";
  const [deploying, setDeploying] = useState(false);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectId: projectIdTrimmed,
  });

  const {
    disconnectGithubAuth,
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
  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );

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
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          request: {
            kind: "github",
            repository: repo,
            target: existingProjectDeploymentTarget({
              projectName: currentProject.resourceName,
              projectId: projectIdTrimmed,
            }),
          },
        });
        if (outcome.kind !== "github") {
          return;
        }
        if (outcome.taskId != null) {
          dispatchDeployTaskCreatedEvent({
            projectName: outcome.projectName,
            repoFullName: outcome.sourceLabel,
            taskId: outcome.taskId,
          });
        }
        toast.success(outcome.taskMessage);
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
      deploymentAdapters,
      kubeconfig,
      namespace,
      onClose,
      projectIdTrimmed,
    ]
  );

  const handleDisconnect = useCallback(async () => {
    try {
      await disconnectGithubAuth();
      await mutateRepos([], { revalidate: false });
      toast.success("Disconnected GitHub.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not disconnect GitHub."
      );
    }
  }, [disconnectGithubAuth, mutateRepos]);

  const actions = useMemo(
    () => ({
      onAuthorize: initiateGithubAuth,
      onDisconnect: handleDisconnect,
      onDeploy: handleDeploy,
    }),
    [handleDeploy, handleDisconnect, initiateGithubAuth]
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
