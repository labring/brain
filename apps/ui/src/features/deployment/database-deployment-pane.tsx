"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { Database } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DatabaseDeployer,
  type DatabaseDeploymentSettings,
} from "@/features/deployment/database-deployer";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/lib/direct-db-deployment-options";

export function DatabaseDeploymentPane({
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
  const databaseOptions = DIRECT_DB_DEPLOYMENT_OPTIONS;
  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";

  const deploy = useCallback(
    async (settings: DatabaseDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
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
        if (onDeployed != null) {
          onDeployed().catch(() => undefined);
        }
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not deploy database."
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
      closeAriaLabel="Close database deployment pane"
      icon={<Database aria-hidden className="size-4 text-blue-400" />}
      label="Database deployment pane"
      onClose={onClose}
      subtitle={
        currentProject.displayName
          ? `Deploy into ${currentProject.displayName}.`
          : "Deploy into the current project."
      }
      title="Deploy Database"
    >
      <DatabaseDeployer
        busy={deploying || currentProject.isLoading}
        databaseOptions={databaseOptions}
        onDeploy={deploy}
      />
    </SidePane>
  );
}
