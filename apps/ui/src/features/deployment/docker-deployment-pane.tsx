"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { SidePane } from "@workspace/ui/components/side-pane";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type DeploymentTaskEditRedeploy,
  useRedeployOverwriteGate,
} from "@/features/deployment/deployment-task-redeploy";
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
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

export function DockerDeploymentPane({
  kubeconfig,
  namespace,
  onClose,
  onDeployed,
  projectId,
  redeploy,
}: {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  onDeployed?: () => Promise<unknown>;
  projectId: string;
  redeploy?: DeploymentTaskEditRedeploy;
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
  const overwriteGate = useRedeployOverwriteGate(
    redeploy?.overwriteWarning ?? false
  );
  const initialSettings = useMemo(
    () =>
      redeploy?.source.kind === "docker"
        ? (redeploy.source.settings as unknown as DockerDeploymentSettings)
        : undefined,
    [redeploy]
  );

  const deploy = useCallback(
    async (settings: DockerDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          predecessorTaskId: redeploy?.predecessorTaskId,
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
            taskId: outcome.taskId,
          });
        }
        if (onDeployed != null) {
          onDeployed().catch(() => undefined);
        }
      } catch (error) {
        toastErrorDetail(
          "Could not deploy Docker AP.",
          errorDescription(error, "Could not deploy Docker AP.")
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
      redeploy,
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
      title={
        redeploy == null
          ? "Deploy Docker Image"
          : "Edit & Redeploy Docker Image"
      }
    >
      <DockerDeployer
        busy={deploying || currentProject.isLoading}
        deployLabel={redeploy == null ? undefined : "Redeploy"}
        initialSettings={initialSettings}
        onDeploy={(settings) => {
          overwriteGate.gate(() => {
            deploy(settings).catch(() => undefined);
          });
        }}
      />
      {overwriteGate.dialog}
    </SidePane>
  );
}
