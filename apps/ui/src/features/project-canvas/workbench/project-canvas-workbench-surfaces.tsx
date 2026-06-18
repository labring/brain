"use client";

import type { ReactNode } from "react";
import { SealosSkillsWorkflowPane } from "@/components/sealos-skills-workflow-pane";
import { DatabaseDeploymentPane } from "@/features/deployment/database-deployment-pane";
import { DeploymentTaskTimelinePane } from "@/features/deployment/deployment-task-timeline-pane";
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
import type {
  ProjectCanvasSideRenderModel,
  ProjectCanvasSurfaceRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import type { SettingsLeaveGuardRegistration } from "@/features/project-settings/settings-leave-guard";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";

export interface ProjectCanvasSurfaceHostActions {
  closeDrawerSurface: () => void;
  closeMainSurface: () => void;
  closeResourceLogsSurface: () => void;
  closeResourcePane: () => void;
  onDbServiceRestoreAccepted: (target: {
    name: string;
    namespace: string;
  }) => void;
  registerSettingsLeaveGuard: SettingsLeaveGuardRegistration;
  repairSide: (entry: ProjectSideSurfaceEntry | null) => void;
}

export interface ProjectCanvasSurfaceHostProps {
  actions: ProjectCanvasSurfaceHostActions;
  dialogs?: ReactNode;
  kubeconfig: string;
  namespace: string;
  projectId: string;
  refreshWorkloadLists: () => Promise<unknown>;
  surfaceModel: ProjectCanvasSurfaceRenderModel;
}

export function ProjectCanvasSurfaceHost({
  actions,
  dialogs,
  kubeconfig,
  namespace,
  projectId,
  refreshWorkloadLists,
  surfaceModel,
}: ProjectCanvasSurfaceHostProps) {
  const { drawer, main, side } = surfaceModel;

  const canvasSidePaneEntry = canvasSidePaneEntryFromRenderModel(side);
  const deploymentTaskTimelineEntry =
    side?.kind === "global" && side.entry.kind === "deploymentTaskTimeline"
      ? side.entry
      : null;
  const sideResourceContent = side?.kind === "resource" ? side.content : null;
  const dbAccessMain = main?.kind === "dbAccess" ? main : null;

  return (
    <>
      <ProjectCanvasSidePaneSlot
        databaseDeploymentPane={
          <DatabaseDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={actions.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        deploymentTaskTimelinePane={
          deploymentTaskTimelineEntry == null ? null : (
            <DeploymentTaskTimelinePane
              kubeconfig={kubeconfig}
              namespace={namespace}
              onClose={actions.closeResourcePane}
              taskId={deploymentTaskTimelineEntry.taskId}
            />
          )
        }
        dockerDeploymentPane={
          <DockerDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={actions.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        entry={canvasSidePaneEntry}
        githubDeploymentPane={
          <GitHubDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={actions.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
        resourcePane={
          <ProjectCanvasResourcePane
            content={sideResourceContent}
            kubeconfig={kubeconfig}
            onClose={actions.closeResourcePane}
            onRepairSideEntry={actions.repairSide}
            onSettingsLeaveGuardChange={actions.registerSettingsLeaveGuard}
            onUpdated={refreshWorkloadLists}
          />
        }
        skillsWorkflowPane={
          <SealosSkillsWorkflowPane onClose={actions.closeResourcePane} />
        }
        templateDeploymentPane={
          <TemplateDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={actions.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectId={projectId}
          />
        }
      />
      <MainActionSurface
        kubeconfig={kubeconfig}
        model={dbAccessMain}
        namespace={namespace}
        onClose={actions.closeMainSurface}
        onDbServiceRestoreAccepted={actions.onDbServiceRestoreAccepted}
        projectId={projectId}
        refreshProjectCanvas={refreshWorkloadLists}
      />
      {main?.kind === "apLogs" ? (
        <WorkloadLogsPane
          node={main.node}
          onClose={actions.closeResourceLogsSurface}
        />
      ) : null}
      {main?.kind === "dbLogs" ? (
        <DatabaseLogsPane
          kubeconfig={kubeconfig}
          node={main.node}
          onClose={actions.closeResourceLogsSurface}
          open
        />
      ) : null}
      {dialogs}
      {drawer?.kind === "apTerminal" ? (
        <WorkloadTerminalPane
          node={drawer.node}
          onClose={actions.closeDrawerSurface}
        />
      ) : null}
      {drawer?.kind === "dbTerminal" ? (
        <DatabaseTerminalPane
          node={drawer.node}
          onClose={actions.closeDrawerSurface}
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
    case "deploymentTaskTimeline":
      return { kind: "deploymentTaskTimeline" };
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
