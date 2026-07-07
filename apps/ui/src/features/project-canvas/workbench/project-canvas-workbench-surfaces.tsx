"use client";

import { projectSurfaceMotionMs } from "@workspace/ui/lib/project-surface-motion";
import { memo, type ReactNode, useEffect, useRef, useState } from "react";
import { SealosSkillsWorkflowPane } from "@/components/sealos-skills-workflow-pane";
import { DatabaseDeploymentPane } from "@/features/deployment/database-deployment-pane";
import type { DeploymentTaskEditRedeploy } from "@/features/deployment/deployment-task-redeploy";
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
import type {
  SettingsLaunchContext,
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/project-settings/settings-types";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { DeployTaskDTO } from "@/lib/deploy-task/types";

export interface ProjectCanvasSurfaceHostActions {
  closeDrawerSurface: () => void;
  closeMainSurface: () => void;
  closeResourceLogsSurface: () => void;
  closeResourcePane: () => void;
  consumeSettingsLaunchContext: () => void;
  onDbServiceRestoreAccepted: (target: {
    name: string;
    namespace: string;
  }) => void;
  registerSettingsLeaveGuard: SettingsLeaveGuardRegistration;
  repairSide: (entry: ProjectSideSurfaceEntry | null) => void;
}

export interface ProjectCanvasSurfaceHostProps {
  actions: ProjectCanvasSurfaceHostActions;
  /** Active edited-redeploy gesture consumed by the deployment panes. */
  deploymentTaskRedeploy?: DeploymentTaskEditRedeploy | null;
  dialogs?: ReactNode;
  kubeconfig: string;
  namespace: string;
  /** Opens the matching deployment pane prefilled from a task (US10). */
  onEditRedeployTask?: (task: DeployTaskDTO) => void;
  projectId: string;
  refreshWorkloadLists: () => Promise<unknown>;
  settingsLaunchContext?: SettingsLaunchContext;
  settingsReadModelHints?: SettingsReadModelHints;
  settingsSessionEvents?: SettingsSessionEvents;
  surfaceModel: ProjectCanvasSurfaceRenderModel;
}

export const ProjectCanvasSurfaceHost = memo(function ProjectCanvasSurfaceHost({
  actions,
  deploymentTaskRedeploy,
  dialogs,
  kubeconfig,
  namespace,
  onEditRedeployTask,
  projectId,
  refreshWorkloadLists,
  settingsLaunchContext,
  settingsReadModelHints,
  settingsSessionEvents,
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
            redeploy={
              deploymentTaskRedeploy?.source.kind === "database"
                ? deploymentTaskRedeploy
                : undefined
            }
          />
        }
        deploymentTaskTimelinePane={
          deploymentTaskTimelineEntry == null ? null : (
            <DeploymentTaskTimelinePane
              kubeconfig={kubeconfig}
              namespace={namespace}
              onClose={actions.closeResourcePane}
              onEditRedeploy={onEditRedeployTask}
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
            redeploy={
              deploymentTaskRedeploy?.source.kind === "docker"
                ? deploymentTaskRedeploy
                : undefined
            }
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
            redeploy={
              deploymentTaskRedeploy?.source.kind === "github"
                ? deploymentTaskRedeploy
                : undefined
            }
          />
        }
        resourcePane={
          <ProjectCanvasResourcePane
            content={sideResourceContent}
            kubeconfig={kubeconfig}
            onClose={actions.closeResourcePane}
            onLaunchContextConsumed={actions.consumeSettingsLaunchContext}
            onRepairSideEntry={actions.repairSide}
            onSettingsLeaveGuardChange={actions.registerSettingsLeaveGuard}
            onUpdated={refreshWorkloadLists}
            settingsLaunchContext={settingsLaunchContext}
            settingsReadModelHints={settingsReadModelHints}
            settingsSessionEvents={settingsSessionEvents}
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
            redeploy={
              deploymentTaskRedeploy?.source.kind === "template"
                ? deploymentTaskRedeploy
                : undefined
            }
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
      <ProjectCanvasDrawerSlot
        drawer={drawer}
        onClose={actions.closeDrawerSurface}
        projectId={projectId}
      />
    </>
  );
});

type ProjectCanvasDrawerRenderModel = ProjectCanvasSurfaceRenderModel["drawer"];

function ProjectCanvasDrawerSlot({
  drawer,
  onClose,
  projectId,
}: {
  drawer: ProjectCanvasDrawerRenderModel;
  onClose: () => void;
  projectId: string;
}) {
  const initialDrawer = drawer ?? null;
  const [renderedDrawer, setRenderedDrawer] =
    useState<ProjectCanvasDrawerRenderModel>(initialDrawer);
  const [open, setOpen] = useState(initialDrawer !== null);
  const presentRef = useRef(initialDrawer !== null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const clearCloseTimer = () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
    const clearOpenFrame = () => {
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
        openFrameRef.current = null;
      }
    };

    if (drawer !== null) {
      const wasPresent = presentRef.current;
      presentRef.current = true;
      clearCloseTimer();
      clearOpenFrame();
      setRenderedDrawer(drawer);

      if (wasPresent) {
        setOpen(true);
        return;
      }

      setOpen(false);
      openFrameRef.current = requestAnimationFrame(() => {
        openFrameRef.current = null;
        setOpen(true);
      });
      return;
    }

    if (!presentRef.current) {
      return;
    }

    presentRef.current = false;
    clearOpenFrame();
    setOpen(false);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      setRenderedDrawer(null);
    }, projectSurfaceMotionMs());
  }, [drawer]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        clearTimeout(closeTimerRef.current);
      }
      if (openFrameRef.current !== null) {
        cancelAnimationFrame(openFrameRef.current);
      }
    },
    []
  );

  if (renderedDrawer === null) {
    return null;
  }

  switch (renderedDrawer.kind) {
    case "apTerminal":
      return (
        <WorkloadTerminalPane
          node={renderedDrawer.node}
          onClose={onClose}
          open={open}
        />
      );
    case "dbTerminal":
      return (
        <DatabaseTerminalPane
          node={renderedDrawer.node}
          onClose={onClose}
          open={open}
          projectId={projectId}
        />
      );
    case "pendingTarget":
      return null;
    default:
      return renderedDrawer satisfies never;
  }
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
