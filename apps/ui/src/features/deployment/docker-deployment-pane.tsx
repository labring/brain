"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { SidePane } from "@workspace/ui/components/side-pane";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@/features/deployment/docker-deployer";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";

export function DockerDeploymentPane({
  kubeconfig,
  namespace,
  onClose,
  onDeployed,
  projectId,
}: {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  onDeployed?: () => Promise<unknown>;
  projectId: string;
}) {
  const [deploying, setDeploying] = useState(false);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectId,
  });
  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";

  const deploy = useCallback(
    async (settings: DockerDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          request: {
            kind: "docker",
            settings,
            target: existingProjectDeploymentTarget({
              projectName,
              projectId,
            }),
          },
        });
        if (outcome.kind !== "docker") {
          return;
        }
        toast.success(outcome.taskMessage);
        onClose();
        if (outcome.taskId != null) {
          dispatchDeployTaskCreatedEvent({
            projectId: outcome.projectId,
            projectName: outcome.projectName,
            sourceKind: "docker",
            sourceLabel: outcome.sourceLabel,
            taskId: outcome.taskId,
          });
        }
        if (onDeployed != null) {
          onDeployed().catch(() => undefined);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not deploy Docker AP."
        );
      } finally {
        setDeploying(false);
      }
    },
    [
      deploymentAdapters,
      kubeconfig,
      namespace,
      onClose,
      onDeployed,
      projectName,
      projectId,
    ]
  );

  return (
    <SidePane
      busy={deploying || currentProject.isLoading}
      closeAriaLabel="Close Docker deployment pane"
      icon={
        <ProjectSourceDockerIcon aria-hidden className="size-4 text-blue-400" />
      }
      label="Docker deployment pane"
      onClose={onClose}
      subtitle={
        currentProject.displayName
          ? `Deploy into ${currentProject.displayName}.`
          : "Deploy into the current project."
      }
      title="Deploy Docker Image"
    >
      <DockerDeployer
        busy={deploying || currentProject.isLoading}
        onDeploy={deploy}
      />
    </SidePane>
  );
}
