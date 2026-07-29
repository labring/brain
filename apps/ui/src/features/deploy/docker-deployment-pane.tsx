"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { SidePane } from "@workspace/ui/components/side-pane";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type DeploymentTaskEditRedeploy,
  useRedeployOverwriteGate,
} from "@/features/deploy/deployment-task-redeploy";
import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@/features/deploy/docker-deployer";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deploy/pipeline";
import { dispatchDeployTaskCreatedEvent } from "@/features/deploy/task/browser-events";
import { useCurrentProjectDisplayName } from "@/features/deploy/use-current-project-display-name";
import { useDeploymentTargetAdapters } from "@/features/deploy/use-deployment-target-adapters";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

function stringArrayField(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function rowArrayField<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) &&
    value.every((item) => item != null && typeof item === "object")
    ? (value as T[])
    : undefined;
}

/**
 * The persisted docker source settings were produced by this same form, but
 * they cross the API as an untyped record — pick fields defensively instead
 * of trusting a cast (a malformed array would crash the deployer prefill).
 */
function dockerInitialSettings(
  redeploy: DeploymentTaskEditRedeploy | undefined
): Partial<DockerDeploymentSettings> | undefined {
  if (redeploy?.source.kind !== "docker") {
    return undefined;
  }
  const raw = redeploy.source.settings;
  const args = stringArrayField(raw.args);
  const command = stringArrayField(raw.command);
  const configMaps = rowArrayField<
    NonNullable<DockerDeploymentSettings["configMaps"]>[number]
  >(raw.configMaps);
  const env = rowArrayField<DockerDeploymentSettings["env"][number]>(raw.env);
  const storage = rowArrayField<
    NonNullable<DockerDeploymentSettings["storage"]>[number]
  >(raw.storage);
  return {
    ...(typeof raw.appListeningPort === "number"
      ? { appListeningPort: raw.appListeningPort }
      : {}),
    ...(args == null ? {} : { args }),
    ...(command == null ? {} : { command }),
    ...(configMaps == null ? {} : { configMaps }),
    ...(env == null ? {} : { env }),
    ...(typeof raw.image === "string" ? { image: raw.image } : {}),
    ...(storage == null ? {} : { storage }),
  };
}

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
  const deploymentAdapters = useDeploymentTargetAdapters({
    kubeconfig,
    namespace,
  });
  const projectName = currentProject.resourceName?.trim() ?? "";
  const overwriteGate = useRedeployOverwriteGate(
    redeploy?.overwriteWarning ?? false
  );
  const initialSettings = useMemo(
    () => dockerInitialSettings(redeploy),
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
