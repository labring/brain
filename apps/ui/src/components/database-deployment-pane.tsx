"use client";

import {
  DatabaseDeployer,
  type DatabaseDeploymentSettings,
} from "@workspace/ui/components/database-deployer";
import { SidePane } from "@workspace/ui/components/side-pane";
import { Database } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { k8sApplyYaml } from "@/features/project-canvas/k8s/http/apply-yaml";
import { useDbCompositions } from "@/hooks/compositions/use-db-compositions";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { dbDeploymentChoicesFromCompositionRows } from "@/lib/db-composition-options";
import { renderDbDeploymentYaml } from "@/lib/db-deployment-yaml";
import { childResourceName } from "@/lib/project-child-resource-name";

export function DatabaseDeploymentPane({
  kubeconfig,
  namespace,
  onClose,
  onDeployed,
  projectUid,
}: {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  onDeployed?: () => Promise<unknown>;
  projectUid: string;
}) {
  const [deploying, setDeploying] = useState(false);
  const currentProject = useCurrentProjectDisplayName({
    kubeconfig,
    namespace,
    projectUid,
  });
  const { items: dbCompositionRows } = useDbCompositions({
    kubeconfig,
    toItems: true,
  });
  const databaseOptions = useMemo(
    () => dbDeploymentChoicesFromCompositionRows(dbCompositionRows),
    [dbCompositionRows]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";

  const deploy = useCallback(
    async (settings: DatabaseDeploymentSettings) => {
      const choice = databaseOptions.find(
        (option) => option.id === settings.databaseId
      );
      if (kubeconfig.trim() === "" || namespace.trim() === "") {
        toast.error("Kubeconfig or namespace is missing.");
        return;
      }
      if (projectName === "") {
        toast.error("Could not resolve the current project.");
        return;
      }
      if (choice == null) {
        toast.error("Choose a database engine.");
        return;
      }

      const dbName = childResourceName(projectName);
      const yaml = renderDbDeploymentYaml({
        compositionName: choice.id,
        engine: choice.engine,
        name: dbName,
        namespace,
        projectName,
        quota: settings.instancePreset,
        replicas: settings.replicas,
        template: choice.template,
      });

      setDeploying(true);
      try {
        await k8sApplyYaml(kubeconfig, yaml);
        toast.success(`Deployed database "${dbName}".`);
        await onDeployed?.();
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not deploy database."
        );
      } finally {
        setDeploying(false);
      }
    },
    [databaseOptions, kubeconfig, namespace, onClose, onDeployed, projectName]
  );

  return (
    <SidePane
      busy={deploying || currentProject.isLoading}
      closeAriaLabel="Close database deployment pane"
      icon={<Database aria-hidden className="size-4 text-blue-500" />}
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
