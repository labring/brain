"use client";

import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@workspace/ui/components/docker-deployer";
import { SidePane } from "@workspace/ui/components/side-pane";
import { Package } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useApCompositions } from "@/hooks/compositions/use-ap-composition";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

export function DockerDeploymentPane({
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
  const { items: apCompositionRows } = useApCompositions({
    kubeconfig,
    toItems: true,
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
          apCompositionRows,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          request: {
            kind: "docker",
            settings,
            target: existingProjectDeploymentTarget({
              projectName,
              projectUid,
            }),
          },
          routingDomain: routingDomainFromKubeconfig(kubeconfig),
        });
        if (outcome.kind !== "docker") {
          return;
        }
        toast.success(`Deployed Docker AP "${outcome.apName}".`);
        await onDeployed?.();
        onClose();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not deploy Docker AP."
        );
      } finally {
        setDeploying(false);
      }
    },
    [
      apCompositionRows,
      deploymentAdapters,
      kubeconfig,
      namespace,
      onClose,
      onDeployed,
      projectName,
      projectUid,
    ]
  );

  return (
    <SidePane
      busy={deploying || currentProject.isLoading}
      closeAriaLabel="Close Docker deployment pane"
      icon={<Package aria-hidden className="size-4 text-blue-500" />}
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
