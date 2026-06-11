"use client";

import { SealosSkillsWorkflowPane } from "@/components/sealos-skills-workflow-pane";
import { DatabaseDeploymentPane } from "@/features/deployment/database-deployment-pane";
import { DockerDeploymentPane } from "@/features/deployment/docker-deployment-pane";
import { GitHubDeploymentPane } from "@/features/deployment/github-deployment-pane";
import { TemplateDeploymentPane } from "@/features/deployment/template-deployment-pane";
import { MainActionSurface } from "@/features/project-canvas/actions/canvas-action-surface";
import { DatabaseLogsPane } from "@/features/project-canvas/panels/database-logs-pane";
import { DatabaseTerminalPane } from "@/features/project-canvas/panels/database-terminal-pane";
import { ProjectCanvasResourcePane } from "@/features/project-canvas/panels/project-canvas-resource-pane";
import {
  type ProjectCanvasSidePaneEntry,
  ProjectCanvasSidePaneSlot,
} from "@/features/project-canvas/panels/project-canvas-side-pane-slot";
import { WorkloadLogsPane } from "@/features/project-canvas/panels/workload-logs-panel";
import { WorkloadTerminalPane } from "@/features/project-canvas/panels/workload-terminal-panel";
import type { ProjectCanvasSideRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import type { useProjectCanvas } from "@/features/project-canvas/workbench/use-project-canvas";

type ProjectCanvasWorkbenchState = ReturnType<typeof useProjectCanvas>;

export interface ProjectCanvasWorkbenchSurfacesProps {
  kubeconfig: string;
  namespace: string;
  projectId: string;
  refreshWorkloadLists: () => Promise<unknown>;
  workbench: ProjectCanvasWorkbenchState;
}

export function ProjectCanvasWorkbenchSurfaces({
  kubeconfig,
  namespace,
  projectId,
  refreshWorkloadLists,
  workbench,
}: ProjectCanvasWorkbenchSurfacesProps) {
  const { drawer, main, side } = workbench.surfaceRenderModel;

  const canvasSidePaneEntry = canvasSidePaneEntryFromRenderModel(side);
  const sideResourceContent = side?.kind === "resource" ? side.content : null;
  const dbAccessMain = main?.kind === "dbAccess" ? main : null;

  return (
    <>
      <ProjectCanvasSidePaneSlot
        databaseDeploymentPane={
          <DatabaseDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        dockerDeploymentPane={
          <DockerDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        entry={canvasSidePaneEntry}
        githubDeploymentPane={
          <GitHubDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        resourcePane={
          <ProjectCanvasResourcePane
            content={sideResourceContent}
            kubeconfig={kubeconfig}
            onClose={workbench.closeResourcePane}
            onRepairSideEntry={workbench.repairSide}
            onSettingsLeaveGuardChange={workbench.registerSettingsLeaveGuard}
            onUpdated={refreshWorkloadLists}
          />
        }
        skillsWorkflowPane={
          <SealosSkillsWorkflowPane onClose={workbench.closeResourcePane} />
        }
        templateDeploymentPane={
          <TemplateDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
      />
      <MainActionSurface
        kubeconfig={kubeconfig}
        model={dbAccessMain}
        namespace={namespace}
        onClose={workbench.closeMainSurface}
        onDbServiceRestoreAccepted={workbench.onDbServiceRestoreAccepted}
        projectId={projectId}
        refreshProjectCanvas={refreshWorkloadLists}
      />
      {main?.kind === "apLogs" ? (
        <WorkloadLogsPane
          node={main.node}
          onClose={workbench.closeResourceLogsSurface}
        />
      ) : null}
      {main?.kind === "dbLogs" ? (
        <DatabaseLogsPane
          kubeconfig={kubeconfig}
          node={main.node}
          onClose={workbench.closeResourceLogsSurface}
          open
        />
      ) : null}
      {workbench.settingsLeaveGuardDialog}
      {workbench.resourceDeleteDialog}
      {drawer?.kind === "apTerminal" ? (
        <WorkloadTerminalPane
          node={drawer.node}
          onClose={workbench.closeDrawerSurface}
        />
      ) : null}
      {drawer?.kind === "dbTerminal" ? (
        <DatabaseTerminalPane
          node={drawer.node}
          onClose={workbench.closeDrawerSurface}
          projectId={projectId}
        />
      ) : null}
    </>
  );
}

function canvasSidePaneEntryFromRenderModel(
  side: ProjectCanvasSideRenderModel
): ProjectCanvasSidePaneEntry {
  if (side == null || side.kind === "pendingTarget") {
    return null;
  }
  if (side.kind === "resource") {
    return { kind: "resource" };
  }
  switch (side.entry.kind) {
    case "databaseDeployment":
      return { kind: "databaseDeployment" };
    case "dockerDeployment":
      return { kind: "dockerDeployment" };
    case "githubDeployment":
      return { kind: "githubDeployment" };
    case "projectCreation":
      return { kind: "projectCreation" };
    case "skillsWorkflow":
      return { kind: "skillsWorkflow" };
    case "templateDeployment":
      return { kind: "templateDeployment" };
    default:
      return side.entry satisfies never;
  }
}
