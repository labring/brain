"use client";

import { SidePane, SidePaneFooter } from "@workspace/ui/components/side-pane";
import { Database } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DatabaseDeployer,
  type DatabaseDeploymentSettings,
} from "@/features/deploy/database-deployer";
import { DeployBillingNoticeCard } from "@/features/deploy/deploy-billing-notice-card";
import {
  type DeploymentTaskEditRedeploy,
  useRedeployOverwriteGate,
} from "@/features/deploy/deployment-task-redeploy";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/features/deploy/direct-db-deployment-options";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deploy/pipeline";
import { dispatchDeployTaskCreatedEvent } from "@/features/deploy/task/browser-events";
import { useCurrentProjectDisplayName } from "@/features/deploy/use-current-project-display-name";
import { useDeployBillingNotice } from "@/features/deploy/use-deploy-billing-notice";
import { useDeploymentTargetAdapters } from "@/features/deploy/use-deployment-target-adapters";
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

// Every database preset carries a storage request, so a full storage quota
// dooms this pane's every deploy (ADR-0069).
const DATABASE_PANE_CONSUMES = ["storage"] as const;

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
  const deploymentAdapters = useDeploymentTargetAdapters({
    kubeconfig,
    namespace,
  });
  const projectName = currentProject.resourceName?.trim() ?? "";
  const overwriteGate = useRedeployOverwriteGate(
    redeploy?.overwriteWarning ?? false
  );
  // The pre-deploy notice (ADR-0069): a condition that dooms this deploy is
  // voiced above the form, which stays usable — enforcement lives at the
  // platform, and a pressed-through failure comes back explained. Every
  // database preset includes storage, so a full storage quota dooms this
  // pane like the universal quotas do.
  const billingNotice = useDeployBillingNotice({
    paneConsumes: DATABASE_PANE_CONSUMES,
  });
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
      {billingNotice != null && (
        <DeployBillingNoticeCard notice={billingNotice} />
      )}
      <DatabaseDeployer.Root
        busy={deploying || currentProject.isLoading}
        databaseOptions={databaseOptions}
        initialSettings={initialSettings}
        onDeploy={(settings) => {
          overwriteGate.gate(() => {
            deploy(settings).catch(() => undefined);
          });
        }}
      >
        <DatabaseDeployer.Fields />
        <SidePaneFooter>
          <DatabaseDeployer.Submit
            className="w-full"
            label={redeploy == null ? undefined : "Redeploy"}
          />
        </SidePaneFooter>
      </DatabaseDeployer.Root>
      {overwriteGate.dialog}
    </SidePane>
  );
}
