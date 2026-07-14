"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { Database } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { createDeploymentTargetClientAdapters } from "@/features/deploy/client-adapters";
import {
  DatabaseDeployer,
  type DatabaseDeploymentSettings,
} from "@/features/deploy/database-deployer";
import {
  type DeploymentTaskEditRedeploy,
  useRedeployOverwriteGate,
} from "@/features/deploy/deployment-task-redeploy";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/features/deploy/direct-db-deployment-options";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deploy/pipeline";
import { useCurrentProjectDisplayName } from "@/features/deploy/use-current-project-display-name";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

function databaseInitialSettings(
  redeploy: DeploymentTaskEditRedeploy | undefined
): Partial<DatabaseDeploymentSettings> | undefined {
  if (redeploy?.source.kind !== "database") {
    return undefined;
  }
  const settings = redeploy.source.settings;
  return {
    ...(typeof settings.databaseId === "string"
      ? { databaseId: settings.databaseId }
      : {}),
    ...(typeof settings.instancePreset === "string"
      ? {
          instancePreset:
            settings.instancePreset as DatabaseDeploymentSettings["instancePreset"],
        }
      : {}),
    ...(typeof settings.replicas === "number"
      ? { replicas: settings.replicas }
      : {}),
  };
}

export function DatabaseDeploymentPane({
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
  const databaseOptions = DIRECT_DB_DEPLOYMENT_OPTIONS;
  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";
  const overwriteGate = useRedeployOverwriteGate(
    redeploy?.overwriteWarning ?? false
  );
  const initialSettings = useMemo(
    () => databaseInitialSettings(redeploy),
    [redeploy]
  );

  const deploy = useCallback(
    async (settings: DatabaseDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          predecessorTaskId: redeploy?.predecessorTaskId,
          request: {
            kind: "database",
            settings,
            target: existingProjectDeploymentTarget({
              projectName,
              projectId,
            }),
          },
        });
        if (outcome.kind !== "database") {
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
          "Could not deploy database.",
          errorDescription(error, "Could not deploy database.")
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
      closeAriaLabel="Close database deployment pane"
      icon={<Database aria-hidden className="size-4 text-blue-400" />}
      label="Database deployment pane"
      onClose={onClose}
      subtitle={
        currentProject.displayName
          ? `Deploy into ${currentProject.displayName}.`
          : "Deploy into the current project."
      }
      title={redeploy == null ? "Deploy Database" : "Edit & Redeploy Database"}
    >
      <DatabaseDeployer
        busy={deploying || currentProject.isLoading}
        databaseOptions={databaseOptions}
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
