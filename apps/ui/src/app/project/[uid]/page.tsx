"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import { Spinner } from "@workspace/ui/components/spinner";
import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseDeploymentPane } from "@/components/database-deployment-pane";
import { DockerDeploymentPane } from "@/components/docker-deployment-pane";
import { GitHubDeploymentPane } from "@/components/github-deployment-pane";
import { useProjectCanvas } from "@/hooks/use-project-canvas";
import { useProjectCanvasLayout } from "@/hooks/use-project-canvas-layout";
import { useProjectServices } from "@/hooks/use-project-services";
import { MainActionSurface } from "@/lib/project-canvas/actions/canvas-action-surface";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/lib/project-canvas/flow/pending-connections";
import { isCanvasNodeGeneratedPosition } from "@/lib/project-canvas/layout/placement";
import { databaseNodeDataFromNode } from "@/lib/project-canvas/nodes/database-node-data";
import { DatabaseConsolePane } from "@/lib/project-canvas/panels/database-console-pane";
import { DatabaseLogsPane } from "@/lib/project-canvas/panels/database-logs-pane";
import { renderProjectCanvasResourcePaneContent } from "@/lib/project-canvas/panels/project-canvas-resource-pane";
import {
  type ProjectCanvasSidePaneEntry,
  ProjectCanvasSidePaneSlot,
} from "@/lib/project-canvas/panels/project-canvas-side-pane-slot";
import { WorkloadLogsPane } from "@/lib/project-canvas/panels/workload-logs-panel";
import { WorkloadTerminalPane } from "@/lib/project-canvas/panels/workload-terminal-panel";
import { telemetryTargetFromCanvasNode } from "@/lib/project-canvas/telemetry/workload-telemetry-node";
import { WorkloadTelemetryProvider } from "@/lib/project-canvas/telemetry/workload-telemetry-react";
import type { ProjectSidePaneSurface } from "@/lib/project-side-pane/controller";
import { useProjectSidePaneSurface } from "@/lib/project-side-pane/react";
import { projectCanvasEntryForAssistantIntent } from "@/lib/project-side-pane/surface-intents";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { DATABASE_PANE, WORKLOAD_PANE } from "@/store/canvas-store";

export default function ProjectUidPage() {
  const params = useParams<{ uid: string }>();
  const uid = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const [pendingApDbReferences, setPendingApDbReferences] = useState<
    PendingApDbCanvasReference[]
  >([]);
  const projectCanvasLayout = useProjectCanvasLayout({
    enabled: kubeconfig.trim() !== "",
    namespace,
    projectUid: uid,
  });

  const {
    canvasState,
    data: projectServicesData,
    error,
    isEmptyGraphLoading,
    refreshWorkloadLists,
  } = useProjectServices({
    canvasLayout: projectCanvasLayout.layout,
    canvasLayoutReady: projectCanvasLayout.layoutReady,
    kubeconfig,
    namespace,
    onCanvasLayoutMerge: projectCanvasLayout.saveLayoutNodes,
    uid,
  });
  const beginPendingApDbReferences = useCallback(
    (references: readonly PendingApDbCanvasReference[]) => {
      const referenceIds = references.map((reference) => reference.id);
      setPendingApDbReferences((current) =>
        addPendingApDbCanvasReferences(current, references)
      );
      return () => {
        setPendingApDbReferences((current) =>
          removePendingApDbCanvasReferences(current, referenceIds)
        );
      };
    },
    []
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset pending edges when the canvas route scope changes.
  useEffect(() => {
    setPendingApDbReferences([]);
  }, [namespace, uid]);
  const canvasEdges = useMemo(() => {
    const pendingEdges = pendingApDbCanvasConnectionEdges({
      existingEdges: canvasState.edges,
      nodes: canvasState.nodes,
      pendingReferences: pendingApDbReferences,
    });
    return pendingEdges.length === 0
      ? canvasState.edges
      : [...canvasState.edges, ...pendingEdges];
  }, [canvasState.edges, canvasState.nodes, pendingApDbReferences]);

  const {
    closeResourcePane,
    closeDrawerSurface,
    closeMainSurface,
    closeResourceLogsSurface,
    connectionOrigin,
    drawerDatabasePane,
    drawerNode,
    drawerWorkloadPane,
    mainDatabasePane,
    main,
    mainNode,
    mainWorkloadPane,
    meta: canvasMeta,
    nodes,
    openSideSurface,
    registerSettingsLeaveGuard,
    selectedEntryRef,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    side,
    sideDatabasePane,
    sideEntryPane,
    sideNode,
    sideVisible,
    sideWorkloadPane,
  } = useProjectCanvas(canvasState.nodes, {
    dbsData: projectServicesData.dbs,
    edges: canvasEdges,
    kubeconfig,
    namespace,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    refreshWorkloadLists,
    selectionReady: !isEmptyGraphLoading,
  });
  const selectedTelemetryTarget = useMemo(
    () => telemetryTargetFromCanvasNode(selectedNode),
    [selectedNode]
  );
  const sideDatabaseData = databaseNodeDataFromNode(sideNode);
  const mainDatabaseData = databaseNodeDataFromNode(mainNode);
  const terminalPlaneOpen =
    drawerWorkloadPane === WORKLOAD_PANE.terminal && drawerNode != null;
  const workloadLogsSurfaceOpen =
    mainWorkloadPane === WORKLOAD_PANE.logs && mainNode != null;
  const databaseConsoleOpen =
    drawerDatabasePane === DATABASE_PANE.console && drawerNode != null;
  const databaseLogsSurfaceOpen =
    mainDatabasePane === DATABASE_PANE.logs && mainNode != null;

  const canvasResourcePaneOpen = Boolean(
    sideWorkloadPane ?? sideDatabasePane ?? sideEntryPane
  );
  const canvasSidePaneEntry = useMemo<ProjectCanvasSidePaneEntry>(() => {
    if (!(sideVisible && side != null)) {
      return null;
    }
    if (side.kind === "databaseDeployment") {
      return { kind: "databaseDeployment" };
    }
    if (side.kind === "dockerDeployment") {
      return { kind: "dockerDeployment" };
    }
    if (side.kind === "githubDeployment") {
      return { kind: "githubDeployment" };
    }
    return canvasResourcePaneOpen ? { kind: "resource" } : null;
  }, [canvasResourcePaneOpen, side, sideVisible]);
  const openDatabaseDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "databaseDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const openDockerDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "dockerDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const openGithubDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "githubDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const projectCanvasSidePaneSurface = useMemo<ProjectSidePaneSurface>(
    () => ({
      id: `project-canvas:${uid}`,
      openAssistantIntent: (intent) => {
        const entry = projectCanvasEntryForAssistantIntent(intent, {
          projectUid: uid,
        });
        if (entry?.kind === "databaseDeployment") {
          openDatabaseDeploymentPane();
          return { status: "handled" as const };
        }
        if (entry?.kind === "dockerDeployment") {
          openDockerDeploymentPane();
          return { status: "handled" as const };
        }
        if (entry?.kind !== "githubDeployment") {
          return { status: "ignored" as const };
        }
        openGithubDeploymentPane();
        return { status: "handled" as const };
      },
    }),
    [
      openDatabaseDeploymentPane,
      openDockerDeploymentPane,
      openGithubDeploymentPane,
      uid,
    ]
  );
  useProjectSidePaneSurface(projectCanvasSidePaneSurface);
  const canvasResourcePane = renderProjectCanvasResourcePaneContent({
    databasePane: sideDatabasePane,
    entryPane: sideEntryPane,
    kubeconfig,
    onClose: closeResourcePane,
    onSettingsLeaveGuardChange: registerSettingsLeaveGuard,
    onUpdated: refreshWorkloadLists,
    selectedDatabaseData: sideDatabaseData,
    selectedEntryRef,
    selectedNode: sideNode,
    workloadPane: sideWorkloadPane,
  });
  const meta = useMemo(
    () => ({
      ...canvasMeta,
      openingFitView: {
        key: `${namespace}:${uid}`,
      },
      viewportFollow: {
        isFollowTarget: isCanvasNodeGeneratedPosition,
        key: `${namespace}:${uid}`,
      },
    }),
    [canvasMeta, namespace, uid]
  );

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {kubeconfig !== "" && error == null && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <WorkloadTelemetryProvider
            kubeconfig={kubeconfig}
            selectedTarget={selectedTelemetryTarget}
          >
            <Canvas.Root
              key={`${namespace}:${uid}`}
              meta={meta}
              state={{
                ...canvasState,
                connectionOrigin,
                edges: canvasEdges,
                nodes,
                selectedEdge,
                selectedNode,
              }}
            >
              <div className="relative min-h-0 flex-1">
                {isEmptyGraphLoading ? (
                  <div
                    aria-live="polite"
                    className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(100%-2rem,20rem)]"
                    data-slot="project-canvas-loading-toast"
                    role="status"
                  >
                    <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-md">
                      <Spinner
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="font-medium text-foreground text-sm">
                        Loading workloads…
                      </span>
                    </div>
                  </div>
                ) : null}
                <Canvas.Flow>
                  <ProjectCanvasSidePaneSlot
                    databaseDeploymentPane={
                      <DatabaseDeploymentPane
                        kubeconfig={kubeconfig}
                        namespace={namespace}
                        onClose={closeResourcePane}
                        onDeployed={refreshWorkloadLists}
                        projectUid={uid}
                      />
                    }
                    dockerDeploymentPane={
                      <DockerDeploymentPane
                        kubeconfig={kubeconfig}
                        namespace={namespace}
                        onClose={closeResourcePane}
                        onDeployed={refreshWorkloadLists}
                        projectUid={uid}
                      />
                    }
                    entry={canvasSidePaneEntry}
                    githubDeploymentPane={
                      <GitHubDeploymentPane onClose={closeResourcePane} />
                    }
                    resourcePane={canvasResourcePane}
                  />
                  <MainActionSurface
                    entry={main}
                    kubeconfig={kubeconfig}
                    namespace={namespace}
                    onClose={closeMainSurface}
                    projectUid={uid}
                    selectedDatabaseData={mainDatabaseData}
                  />
                  {workloadLogsSurfaceOpen ? (
                    <WorkloadLogsPane
                      node={mainNode}
                      onClose={closeResourceLogsSurface}
                    />
                  ) : null}
                  {databaseLogsSurfaceOpen ? (
                    <DatabaseLogsPane
                      kubeconfig={kubeconfig}
                      node={mainNode}
                      onClose={closeResourceLogsSurface}
                      open
                    />
                  ) : null}
                  {settingsLeaveGuardDialog}
                  {terminalPlaneOpen ? (
                    <WorkloadTerminalPane
                      node={drawerNode}
                      onClose={closeDrawerSurface}
                    />
                  ) : null}
                  {databaseConsoleOpen ? (
                    <DatabaseConsolePane
                      node={drawerNode}
                      onClose={closeDrawerSurface}
                      projectUid={uid}
                    />
                  ) : null}
                </Canvas.Flow>
              </div>
            </Canvas.Root>
          </WorkloadTelemetryProvider>
        </div>
      )}
    </div>
  );
}
