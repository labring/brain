"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import { Spinner } from "@workspace/ui/components/spinner";
import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseDeploymentPane } from "@/components/database-deployment-pane";
import { DockerDeploymentPane } from "@/components/docker-deployment-pane";
import { GitHubDeploymentPane } from "@/components/github-deployment-pane";
import { useProjectCanvas } from "@/hooks/use-project-canvas";
import { useProjectCanvasLayout } from "@/hooks/use-project-canvas-layout";
import { useProjectServices } from "@/hooks/use-project-services";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/lib/project-canvas/flow/pending-connections";
import { isCanvasNodeGeneratedPosition } from "@/lib/project-canvas/layout/placement";
import { databaseNodeDataFromNode } from "@/lib/project-canvas/nodes/database-node-data";
import { renderProjectCanvasResourcePaneContent } from "@/lib/project-canvas/panels/project-canvas-resource-pane";
import {
  type ProjectCanvasSidePanePreferredEntry,
  ProjectCanvasSidePaneSlot,
  resolveProjectCanvasSidePaneEntry,
} from "@/lib/project-canvas/panels/project-canvas-side-pane-slot";
import { WorkloadTerminalPane } from "@/lib/project-canvas/panels/workload-terminal-panel";
import { telemetryTargetFromCanvasNode } from "@/lib/project-canvas/telemetry/workload-telemetry-node";
import { WorkloadTelemetryProvider } from "@/lib/project-canvas/telemetry/workload-telemetry-react";
import type { ProjectSidePaneSurface } from "@/lib/project-side-pane/controller";
import { useProjectSidePaneSurface } from "@/lib/project-side-pane/react";
import { projectCanvasEntryForAssistantIntent } from "@/lib/project-side-pane/surface-intents";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { WORKLOAD_PANE } from "@/store/canvas-store";

const GITHUB_DEPLOYMENT_PANE_QUERY_KEY = "githubDeployment" as const;
const DATABASE_DEPLOYMENT_PANE_QUERY_KEY = "databaseDeployment" as const;
const DOCKER_DEPLOYMENT_PANE_QUERY_KEY = "dockerDeployment" as const;

export default function ProjectUidPage() {
  const params = useParams<{ uid: string }>();
  const uid = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const [pendingApDbReferences, setPendingApDbReferences] = useState<
    PendingApDbCanvasReference[]
  >([]);
  const [preferredCanvasSidePaneEntry, setPreferredCanvasSidePaneEntry] =
    useState<ProjectCanvasSidePanePreferredEntry | null>(null);
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
  const [githubDeploymentPaneOpen, setGithubDeploymentPaneOpen] = useQueryState(
    GITHUB_DEPLOYMENT_PANE_QUERY_KEY,
    parseAsBoolean.withDefault(false)
  );
  const [databaseDeploymentPaneOpen, setDatabaseDeploymentPaneOpen] =
    useQueryState(
      DATABASE_DEPLOYMENT_PANE_QUERY_KEY,
      parseAsBoolean.withDefault(false)
    );
  const [dockerDeploymentPaneOpen, setDockerDeploymentPaneOpen] = useQueryState(
    DOCKER_DEPLOYMENT_PANE_QUERY_KEY,
    parseAsBoolean.withDefault(false)
  );
  const replaceDeploymentWithResourcePane = useCallback(() => {
    setPreferredCanvasSidePaneEntry("resource");
    Promise.resolve(setGithubDeploymentPaneOpen(false)).catch(() => undefined);
    Promise.resolve(setDatabaseDeploymentPaneOpen(false)).catch(
      () => undefined
    );
    Promise.resolve(setDockerDeploymentPaneOpen(false)).catch(() => undefined);
  }, [
    setDatabaseDeploymentPaneOpen,
    setDockerDeploymentPaneOpen,
    setGithubDeploymentPaneOpen,
  ]);

  const {
    closeResourcePane,
    connectionOrigin,
    databasePane,
    entryPane,
    meta: canvasMeta,
    nodes,
    registerSettingsLeaveGuard,
    requestResourcePaneReplacement,
    selectedEntryRef,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    workloadPane,
  } = useProjectCanvas(canvasState.nodes, {
    dbsData: projectServicesData.dbs,
    kubeconfig,
    namespace,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    onResourcePaneOpen: replaceDeploymentWithResourcePane,
    refreshWorkloadLists,
    selectionReady: !isEmptyGraphLoading,
  });
  const selectedTelemetryTarget = useMemo(
    () => telemetryTargetFromCanvasNode(selectedNode),
    [selectedNode]
  );
  const selectedDatabaseData = databaseNodeDataFromNode(selectedNode);
  const terminalPlaneOpen =
    workloadPane === WORKLOAD_PANE.terminal && selectedNode != null;
  const canvasResourcePaneOpen = Boolean(
    (terminalPlaneOpen ? null : workloadPane) ?? databasePane ?? entryPane
  );
  const canvasSidePaneEntry = resolveProjectCanvasSidePaneEntry({
    databaseDeploymentPaneOpen,
    dockerDeploymentPaneOpen,
    githubDeploymentPaneOpen,
    preferredEntry: preferredCanvasSidePaneEntry,
    resourcePaneOpen: canvasResourcePaneOpen,
  });
  const closeDatabaseDeploymentPane = useCallback(() => {
    Promise.resolve(setDatabaseDeploymentPaneOpen(false)).catch(
      () => undefined
    );
  }, [setDatabaseDeploymentPaneOpen]);
  const closeGithubDeploymentPane = useCallback(() => {
    Promise.resolve(setGithubDeploymentPaneOpen(false)).catch(() => undefined);
  }, [setGithubDeploymentPaneOpen]);
  const closeDockerDeploymentPane = useCallback(() => {
    Promise.resolve(setDockerDeploymentPaneOpen(false)).catch(() => undefined);
  }, [setDockerDeploymentPaneOpen]);
  const openDatabaseDeploymentPane = useCallback(() => {
    requestResourcePaneReplacement(() => {
      setPreferredCanvasSidePaneEntry("databaseDeployment");
      Promise.resolve(setDockerDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setGithubDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setDatabaseDeploymentPaneOpen(true)).catch(
        () => undefined
      );
    });
  }, [
    requestResourcePaneReplacement,
    setDatabaseDeploymentPaneOpen,
    setDockerDeploymentPaneOpen,
    setGithubDeploymentPaneOpen,
  ]);
  const openDockerDeploymentPane = useCallback(() => {
    requestResourcePaneReplacement(() => {
      setPreferredCanvasSidePaneEntry("dockerDeployment");
      Promise.resolve(setDatabaseDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setGithubDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setDockerDeploymentPaneOpen(true)).catch(() => undefined);
    });
  }, [
    requestResourcePaneReplacement,
    setDatabaseDeploymentPaneOpen,
    setDockerDeploymentPaneOpen,
    setGithubDeploymentPaneOpen,
  ]);
  const openGithubDeploymentPane = useCallback(() => {
    requestResourcePaneReplacement(() => {
      setPreferredCanvasSidePaneEntry("githubDeployment");
      Promise.resolve(setDatabaseDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setDockerDeploymentPaneOpen(false)).catch(
        () => undefined
      );
      Promise.resolve(setGithubDeploymentPaneOpen(true)).catch(() => undefined);
    });
  }, [
    requestResourcePaneReplacement,
    setDatabaseDeploymentPaneOpen,
    setDockerDeploymentPaneOpen,
    setGithubDeploymentPaneOpen,
  ]);
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
    databasePane,
    entryPane,
    kubeconfig,
    onClose: closeResourcePane,
    onSettingsLeaveGuardChange: registerSettingsLeaveGuard,
    onUpdated: refreshWorkloadLists,
    selectedDatabaseData,
    selectedEntryRef,
    selectedNode,
    workloadPane,
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
                        onClose={closeDatabaseDeploymentPane}
                        onDeployed={refreshWorkloadLists}
                        projectUid={uid}
                      />
                    }
                    dockerDeploymentPane={
                      <DockerDeploymentPane
                        kubeconfig={kubeconfig}
                        namespace={namespace}
                        onClose={closeDockerDeploymentPane}
                        onDeployed={refreshWorkloadLists}
                        projectUid={uid}
                      />
                    }
                    entry={canvasSidePaneEntry}
                    githubDeploymentPane={
                      <GitHubDeploymentPane
                        onClose={closeGithubDeploymentPane}
                      />
                    }
                    resourcePane={canvasResourcePane}
                  />
                  {settingsLeaveGuardDialog}
                  {terminalPlaneOpen ? (
                    <WorkloadTerminalPane
                      node={selectedNode}
                      onClose={closeResourcePane}
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
