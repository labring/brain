"use client";

import { SidePane, SidePaneFooter } from "@workspace/ui/components/side-pane";
import { Blocks } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { DeployBillingNoticeCard } from "@/features/deploy/deploy-billing-notice-card";
import {
  type DeploymentTaskEditRedeploy,
  useRedeployOverwriteGate,
} from "@/features/deploy/deployment-task-redeploy";
import {
  existingProjectDeploymentTarget,
  runDeploymentTargetPipeline,
} from "@/features/deploy/pipeline";
import { dispatchDeployTaskCreatedEvent } from "@/features/deploy/task/browser-events";
import type { TemplateDeploymentSettings } from "@/features/deploy/template-deployer";
import { TemplateDeployer } from "@/features/deploy/template-deployer";
import { useCurrentProjectDisplayName } from "@/features/deploy/use-current-project-display-name";
import { useDeployBillingNotice } from "@/features/deploy/use-deploy-billing-notice";
import { useDeploymentTargetAdapters } from "@/features/deploy/use-deployment-target-adapters";
import { useTemplateCatalog } from "@/features/deploy/use-template-catalog";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

export function TemplateDeploymentPane({
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
  const templateCatalog = useTemplateCatalog();
  const deploymentAdapters = useDeploymentTargetAdapters({
    kubeconfig,
    namespace,
  });
  const projectName = currentProject.resourceName?.trim() ?? "";
  const overwriteGate = useRedeployOverwriteGate(
    redeploy?.overwriteWarning ?? false
  );
  const initialSettings = useMemo(
    () =>
      redeploy?.source.kind === "template"
        ? {
            args: redeploy.source.args,
            templateName: redeploy.source.templateName,
          }
        : undefined,
    [redeploy]
  );

  // The pre-deploy notice (ADR-0070): a condition that dooms this deploy is
  // voiced above the form, which stays usable — enforcement lives at the
  // platform, and a pressed-through failure comes back explained.
  const billingNotice = useDeployBillingNotice();

  const deploy = useCallback(
    async (settings: TemplateDeploymentSettings) => {
      setDeploying(true);
      try {
        const outcome = await runDeploymentTargetPipeline({
          adapters: deploymentAdapters,
          credentialsReady: kubeconfig.trim() !== "" && namespace.trim() !== "",
          namespace,
          predecessorTaskId: redeploy?.predecessorTaskId,
          request: {
            args: settings.args,
            kind: "template",
            sensitiveKeys: settings.sensitiveKeys,
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
            taskId: outcome.taskId,
          });
        }
        if (onDeployed != null) {
          onDeployed().catch(() => undefined);
        }
      } catch (error) {
        toastErrorDetail(
          "Could not deploy template.",
          errorDescription(error, "Could not deploy template.")
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
      redeploy,
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
      title={redeploy == null ? "Deploy Template" : "Edit & Redeploy Template"}
    >
      {billingNotice != null && (
        <DeployBillingNoticeCard notice={billingNotice} />
      )}
      <TemplateDeployer.Root
        busy={
          deploying || currentProject.isLoading || templateCatalog.isLoading
        }
        errorMessage={templateCatalog.error?.message}
        initialSettings={initialSettings}
        loading={templateCatalog.isLoading}
        onDeploy={(settings) => {
          overwriteGate.gate(() => {
            deploy(settings).catch(() => undefined);
          });
        }}
        templateOptions={templateCatalog.templates}
      >
        <TemplateDeployer.Fields />
        <SidePaneFooter>
          <TemplateDeployer.Submit
            className="w-full"
            label={redeploy == null ? undefined : "Redeploy"}
          />
        </SidePaneFooter>
      </TemplateDeployer.Root>
      {overwriteGate.dialog}
    </SidePane>
  );
}
