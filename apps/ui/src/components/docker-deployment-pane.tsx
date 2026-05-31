"use client";

import {
  DockerDeployer,
  type DockerDeploymentSettings,
} from "@workspace/ui/components/docker-deployer";
import { SidePane } from "@workspace/ui/components/side-pane";
import { Package } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { k8sApplyYaml } from "@/features/project-canvas/k8s/http/apply-yaml";
import { useApCompositions } from "@/hooks/compositions/use-ap-composition";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import type { CompositionListItem } from "@/lib/crossplane-composition-list";
import {
  DEFAULT_DOCKER_AP_COMPOSITION_NAME,
  renderDockerDeploymentYaml,
} from "@/lib/docker-deployment-yaml";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { childResourceName } from "@/lib/project-child-resource-name";

function pickApTemplate(
  rows: CompositionListItem[] | undefined
): string | undefined {
  return (
    rows?.find(
      (row) =>
        row.metadata.compositionName === DEFAULT_DOCKER_AP_COMPOSITION_NAME
    )?.template ?? rows?.find((row) => row.kind === "AP")?.template
  );
}

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
  const apTemplate = useMemo(
    () => pickApTemplate(apCompositionRows),
    [apCompositionRows]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";

  const deploy = useCallback(
    async (settings: DockerDeploymentSettings) => {
      if (kubeconfig.trim() === "" || namespace.trim() === "") {
        toast.error("Kubeconfig or namespace is missing.");
        return;
      }
      if (projectName === "") {
        toast.error("Could not resolve the current project.");
        return;
      }
      if (!apTemplate?.trim()) {
        toast.error(
          "Could not load an AP composition template from the cluster."
        );
        return;
      }

      const apName = childResourceName(projectName);
      const yaml = renderDockerDeploymentYaml({
        name: apName,
        namespace,
        projectName,
        routingDomain: routingDomainFromKubeconfig(kubeconfig),
        settings,
        template: apTemplate,
      });

      setDeploying(true);
      try {
        await k8sApplyYaml(kubeconfig, yaml);
        toast.success(`Deployed Docker AP "${apName}".`);
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
    [apTemplate, kubeconfig, namespace, onClose, onDeployed, projectName]
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
