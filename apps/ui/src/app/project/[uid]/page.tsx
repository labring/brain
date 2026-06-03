"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import { Spinner } from "@workspace/ui/components/spinner";
import { useAtomValue } from "jotai";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/features/project-canvas/flow/pending-connections";
import { isCanvasNodeGeneratedPosition } from "@/features/project-canvas/layout/placement";
import { useProjectCanvasLayout } from "@/features/project-canvas/layout/use-project-canvas-layout";
import { useProjectServices } from "@/features/project-canvas/snapshot/use-project-services";
import { telemetryTargetFromCanvasNode } from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { WorkloadTelemetryProvider } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import { ProjectCanvasWorkbenchSurfaces } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvas } from "@/features/project-canvas/workbench/use-project-canvas";
import type { ProjectSidePaneAssistantSurface } from "@/features/project-surfaces/assistant-router";
import { useProjectSidePaneSurface } from "@/features/project-surfaces/react";
import { projectCanvasEntryForAssistantIntent } from "@/features/project-surfaces/surface-intents";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

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
    projectId: uid,
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

  const workbench = useProjectCanvas(canvasState.nodes, {
    dbsData: projectServicesData.dbs,
    edges: canvasEdges,
    kubeconfig,
    namespace,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    projectUid: uid,
    refreshWorkloadLists,
    selectionReady: !isEmptyGraphLoading,
  });
  const selectedTelemetryTarget = useMemo(
    () => telemetryTargetFromCanvasNode(workbench.selectedNode),
    [workbench.selectedNode]
  );
  const { openSideSurface } = workbench;
  const openDatabaseDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "databaseDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const openDockerDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "dockerDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const openGithubDeploymentPane = useCallback(() => {
    openSideSurface({ kind: "githubDeployment", projectUid: uid });
  }, [openSideSurface, uid]);
  const projectCanvasSidePaneSurface = useMemo<ProjectSidePaneAssistantSurface>(
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
  const meta = useMemo(
    () => ({
      ...workbench.meta,
      openingFitView: {
        key: `${namespace}:${uid}`,
      },
      viewportFollow: {
        isFollowTarget: isCanvasNodeGeneratedPosition,
        key: `${namespace}:${uid}`,
      },
    }),
    [workbench.meta, namespace, uid]
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
                connectionOrigin: workbench.connectionOrigin,
                edges: canvasEdges,
                nodes: workbench.nodes,
                selectedEdge: workbench.selectedEdge,
                selectedNode: workbench.selectedNode,
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
                  <ProjectCanvasWorkbenchSurfaces
                    kubeconfig={kubeconfig}
                    namespace={namespace}
                    projectUid={uid}
                    refreshWorkloadLists={refreshWorkloadLists}
                    workbench={workbench}
                  />
                </Canvas.Flow>
              </div>
            </Canvas.Root>
          </WorkloadTelemetryProvider>
        </div>
      )}
    </div>
  );
}
