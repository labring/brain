"use client";

import { SidePane } from "@workspace/ui/components/side-pane";
import { Blocks } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { TemplateDeploymentSettings } from "@/features/deployment/template-deployer";
import { TemplateDeployer } from "@/features/deployment/template-deployer";
import { createDeploymentTargetClientAdapters } from "@/features/deployment-target/client-adapters";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deployment-target/pipeline";
import { useCurrentProjectDisplayName } from "@/hooks/use-current-project-display-name";
import { useTemplateCatalog } from "@/hooks/use-template-catalog";
import { dispatchDeployTaskCreatedEvent } from "@/lib/deploy-task/browser-events";

export function TemplateDeploymentPane({
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
  const templateCatalog = useTemplateCatalog();
  const deploymentAdapters = useMemo(
    () => createDeploymentTargetClientAdapters({ kubeconfig, namespace }),
    [kubeconfig, namespace]
  );
  const projectName = currentProject.resourceName?.trim() ?? "";

  const deploy = useCallback(
    async (settings: TemplateDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          request: {
            args: settings.args,
            kind: "template",
            target: existingProjectDeploymentTarget({
              projectName,
              projectId,
            }),
            templateName: settings.templateName,
          },
        });
        if (outcome.kind !== "template") {
          return;
        }
        toast.success(outcome.taskMessage);
        onClose();
        if (outcome.taskId != null) {
          dispatchDeployTaskCreatedEvent({
            projectId: outcome.projectId,
            projectName: outcome.projectName,
            sourceKind: "template",
            sourceLabel: outcome.sourceLabel,
            taskId: outcome.taskId,
          });
        }
        if (onDeployed != null) {
          onDeployed().catch(() => undefined);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not deploy template."
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
      projectId,
      projectName,
    ]
  );

  return (
    <SidePane
      busy={deploying || currentProject.isLoading || templateCatalog.isLoading}
      closeAriaLabel="Close template deployment pane"
      icon={<Blocks aria-hidden className="size-4 text-blue-400" />}
      label="Template deployment pane"
      onClose={onClose}
      subtitle={
        currentProject.displayName
          ? `Deploy into ${currentProject.displayName}.`
          : "Deploy into the current project."
      }
      title="Deploy Template"
    >
      <TemplateDeployer
        busy={
          deploying || currentProject.isLoading || templateCatalog.isLoading
        }
        emptyMessage={
          templateCatalog.error?.message ?? "No templates are available."
        }
        onDeploy={deploy}
        templateOptions={templateCatalog.templates}
      />
    </SidePane>
  );
}
