"use client";

import { DatabaseDeploymentPane } from "@/components/database-deployment-pane";
import { DockerDeploymentPane } from "@/components/docker-deployment-pane";
import { GitHubDeploymentPane } from "@/components/github-deployment-pane";
import { MainActionSurface } from "@/features/project-canvas/actions/canvas-action-surface";
import {
  DATABASE_PANE,
  WORKLOAD_PANE,
} from "@/features/project-canvas/canvas-store";
import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";
import { DatabaseConsolePane } from "@/features/project-canvas/panels/database-console-pane";
import { DatabaseLogsPane } from "@/features/project-canvas/panels/database-logs-pane";
import { ProjectCanvasResourcePane } from "@/features/project-canvas/panels/project-canvas-resource-pane";
import { ProjectCanvasSidePaneSlot } from "@/features/project-canvas/panels/project-canvas-side-pane-slot";
import { WorkloadLogsPane } from "@/features/project-canvas/panels/workload-logs-panel";
import { WorkloadTerminalPane } from "@/features/project-canvas/panels/workload-terminal-panel";
import type { useProjectCanvas } from "@/features/project-canvas/workbench/use-project-canvas";

type ProjectCanvasWorkbenchState = ReturnType<typeof useProjectCanvas>;

export interface ProjectCanvasWorkbenchSurfacesProps {
  kubeconfig: string;
  namespace: string;
  projectUid: string;
  refreshWorkloadLists: () => Promise<unknown>;
  workbench: ProjectCanvasWorkbenchState;
}

export function ProjectCanvasWorkbenchSurfaces({
  kubeconfig,
  namespace,
  projectUid,
  refreshWorkloadLists,
  workbench,
}: ProjectCanvasWorkbenchSurfacesProps) {
  const drawerNode = workbench.drawerNode;
  const mainNode = workbench.mainNode;
  const sideDatabaseData = databaseNodeDataFromNode(workbench.sideNode);
  const mainDatabaseData = databaseNodeDataFromNode(mainNode);
  const terminalSurfaceOpen =
    workbench.drawerWorkloadPane === WORKLOAD_PANE.terminal &&
    drawerNode != null;
  const workloadLogsSurfaceOpen =
    workbench.mainWorkloadPane === WORKLOAD_PANE.logs && mainNode != null;
  const databaseConsoleOpen =
    workbench.drawerDatabasePane === DATABASE_PANE.console &&
    drawerNode != null;
  const databaseLogsSurfaceOpen =
    workbench.mainDatabasePane === DATABASE_PANE.logs && mainNode != null;
  const canvasResourcePaneOpen = Boolean(
    workbench.sideWorkloadPane ??
      workbench.sideDatabasePane ??
      workbench.sideEntryPane
  );

  const canvasSidePaneEntry = (() => {
    if (!(workbench.sideVisible && workbench.side != null)) {
      return null;
    }
    if (workbench.side.kind === "databaseDeployment") {
      return { kind: "databaseDeployment" as const };
    }
    if (workbench.side.kind === "dockerDeployment") {
      return { kind: "dockerDeployment" as const };
    }
    if (workbench.side.kind === "githubDeployment") {
      return { kind: "githubDeployment" as const };
    }
    return canvasResourcePaneOpen ? { kind: "resource" as const } : null;
  })();

  return (
    <>
      <ProjectCanvasSidePaneSlot
        databaseDeploymentPane={
          <DatabaseDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectUid={projectUid}
          />
        }
        dockerDeploymentPane={
          <DockerDeploymentPane
            kubeconfig={kubeconfig}
            namespace={namespace}
            onClose={workbench.closeResourcePane}
            onDeployed={refreshWorkloadLists}
            projectUid={projectUid}
          />
        }
        entry={canvasSidePaneEntry}
        githubDeploymentPane={
          <GitHubDeploymentPane onClose={workbench.closeResourcePane} />
        }
        resourcePane={
          <ProjectCanvasResourcePane
            databasePane={workbench.sideDatabasePane}
            entryPane={workbench.sideEntryPane}
            kubeconfig={kubeconfig}
            onClose={workbench.closeResourcePane}
            onSettingsLeaveGuardChange={workbench.registerSettingsLeaveGuard}
            onUpdated={refreshWorkloadLists}
            selectedDatabaseData={sideDatabaseData}
            selectedEntryRef={workbench.selectedEntryRef}
            selectedNode={workbench.sideNode}
            workloadPane={workbench.sideWorkloadPane}
          />
        }
      />
      <MainActionSurface
        entry={workbench.main}
        kubeconfig={kubeconfig}
        namespace={namespace}
        onClose={workbench.closeMainSurface}
        projectUid={projectUid}
        selectedDatabaseData={mainDatabaseData}
      />
      {workloadLogsSurfaceOpen ? (
        <WorkloadLogsPane
          node={mainNode}
          onClose={workbench.closeResourceLogsSurface}
        />
      ) : null}
      {databaseLogsSurfaceOpen ? (
        <DatabaseLogsPane
          kubeconfig={kubeconfig}
          node={mainNode}
          onClose={workbench.closeResourceLogsSurface}
          open
        />
      ) : null}
      {workbench.settingsLeaveGuardDialog}
      {terminalSurfaceOpen ? (
        <WorkloadTerminalPane
          node={drawerNode}
          onClose={workbench.closeDrawerSurface}
        />
      ) : null}
      {databaseConsoleOpen ? (
        <DatabaseConsolePane
          node={drawerNode}
          onClose={workbench.closeDrawerSurface}
          projectUid={projectUid}
        />
      ) : null}
    </>
  );
}

export interface PreviewProjectCanvasWorkbenchSurfacesProps {
  namespace: string;
  projectUid: string;
  refreshWorkloadLists: () => Promise<unknown>;
  shareToken: string;
  workbench: ProjectCanvasWorkbenchState;
}

export function PreviewProjectCanvasWorkbenchSurfaces({
  namespace,
  projectUid,
  refreshWorkloadLists,
  shareToken,
  workbench,
}: PreviewProjectCanvasWorkbenchSurfacesProps) {
  const mainNode = workbench.mainNode;
  const sideDatabaseData = databaseNodeDataFromNode(workbench.sideNode);
  const mainDatabaseData = databaseNodeDataFromNode(mainNode);
  const workloadLogsSurfaceOpen =
    workbench.mainWorkloadPane === WORKLOAD_PANE.logs && mainNode != null;
  const databaseLogsSurfaceOpen =
    workbench.mainDatabasePane === DATABASE_PANE.logs && mainNode != null;

  return (
    <>
      <ProjectCanvasResourcePane
        databasePane={workbench.sideDatabasePane}
        entryPane={workbench.sideEntryPane}
        onClose={workbench.closeResourcePane}
        onSettingsLeaveGuardChange={workbench.registerSettingsLeaveGuard}
        onUpdated={refreshWorkloadLists}
        readOnly
        selectedDatabaseData={sideDatabaseData}
        selectedEntryRef={workbench.selectedEntryRef}
        selectedNode={workbench.sideNode}
        shareToken={shareToken}
        workloadPane={workbench.sideWorkloadPane}
      />
      <MainActionSurface
        dbAccessEnabled={false}
        entry={workbench.main}
        kubeconfig=""
        namespace={namespace}
        onClose={workbench.closeMainSurface}
        projectUid={projectUid}
        selectedDatabaseData={mainDatabaseData}
      />
      {workloadLogsSurfaceOpen ? (
        <WorkloadLogsPane
          node={mainNode}
          onClose={workbench.closeResourceLogsSurface}
        />
      ) : null}
      {databaseLogsSurfaceOpen ? (
        <DatabaseLogsPane
          kubeconfig=""
          node={mainNode}
          onClose={workbench.closeResourceLogsSurface}
          open
        />
      ) : null}
      {workbench.settingsLeaveGuardDialog}
    </>
  );
}
