"use client";

import { Canvas } from "@workspace/ui/components/canvas/canvas";
import { Spinner } from "@workspace/ui/components/spinner";
import type { Node } from "@xyflow/react";
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
import {
  deploymentPlaceholderTaskIdFromNode,
  deploymentProjectionPatchFromPlaceholderNode,
  isDeploymentPlaceholderNode,
} from "@/features/project-canvas/snapshot/deployment-placeholders";
import { useProjectCanvasResourceSnapshot } from "@/features/project-canvas/snapshot/use-project-canvas-resource-snapshot";
import { telemetryTargetFromCanvasNode } from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { WorkloadTelemetryProvider } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import { ProjectCanvasWorkbenchSurfaces } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import {
  PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET,
  useProjectCanvas,
} from "@/features/project-canvas/workbench/use-project-canvas";
import type { ProjectSidePaneAssistantSurface } from "@/features/project-surfaces/assistant-router";
import { useProjectSidePaneSurface } from "@/features/project-surfaces/react";
import { projectCanvasEntryForAssistantIntent } from "@/features/project-surfaces/surface-intents";
import { patchDeployTaskCanvasProjection } from "@/lib/deploy-task/client";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";

export default function ProjectIdPage() {
  const params = useParams<{ uid: string }>();
  const uid = decodeURIComponent(params.uid ?? "");
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const namespace = useAtomValue(namespaceAtom);
  const [pendingApDbReferences, setPendingApDbReferences] = useState<
    PendingApDbCanvasReference[]
  >([]);
  const projectCanvasLayout = useProjectCanvasLayout({
    enabled: kubeconfig.trim() !== "",
    kubeconfig,
    namespace,
    projectId: uid,
  });

  const {
    apEnvironmentDbReferenceSources,
    canvasState,
    frameState,
    isEmptyGraphLoading,
    isLoading: resourceSnapshotLoading,
    layoutIntent,
    refresh,
  } = useProjectCanvasResourceSnapshot({
    canvasLayout: projectCanvasLayout.layout,
    canvasLayoutReady: projectCanvasLayout.layoutReady,
    kubeconfig,
    namespace,
    uid,
  });
  const saveDeploymentPlaceholderPosition = useCallback(
    async (
      node: Node,
      nodes: readonly Node[],
      mode: "replace" | "set-if-empty",
      source: "generated" | "user"
    ) => {
      const taskId = deploymentPlaceholderTaskIdFromNode(node);
      const patch = deploymentProjectionPatchFromPlaceholderNode({
        node,
        nodes,
        source,
      });
      if (
        taskId === undefined ||
        patch === null ||
        kubeconfig.trim() === "" ||
        namespace.trim() === ""
      ) {
        return;
      }
      await patchDeployTaskCanvasProjection({
        kubeconfig,
        namespace,
        taskId,
        update: {
          mode,
          projection: patch.projection,
        },
      });
      refresh().catch(() => undefined);
    },
    [kubeconfig, namespace, refresh]
  );
  useEffect(() => {
    if (resourceSnapshotLoading || layoutIntent == null) {
      return;
    }
    const save =
      layoutIntent.kind === "first-placement"
        ? projectCanvasLayout.saveFirstPlacementNodes
        : projectCanvasLayout.saveLayoutNodes;
    save(layoutIntent.nodes).catch(() => undefined);
  }, [
    layoutIntent,
    projectCanvasLayout.saveFirstPlacementNodes,
    projectCanvasLayout.saveLayoutNodes,
    resourceSnapshotLoading,
  ]);
  useEffect(() => {
    if (resourceSnapshotLoading) {
      return;
    }
    const savedTaskIds = new Set<string>();
    for (const node of canvasState.nodes) {
      if (
        isDeploymentPlaceholderNode(node) &&
        node.data.hasProjectionPosition !== true &&
        !savedTaskIds.has(node.data.taskId)
      ) {
        savedTaskIds.add(node.data.taskId);
        saveDeploymentPlaceholderPosition(
          node,
          canvasState.nodes,
          "set-if-empty",
          "generated"
        ).catch(() => undefined);
      }
    }
  }, [
    canvasState.nodes,
    resourceSnapshotLoading,
    saveDeploymentPlaceholderPosition,
  ]);
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
    apEnvironmentDbReferenceSources,
    edges: canvasEdges,
    kubeconfig,
    namespace,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange: (node) => {
      if (isDeploymentPlaceholderNode(node)) {
        saveDeploymentPlaceholderPosition(
          node,
          canvasState.nodes,
          "replace",
          "user"
        ).catch(() => undefined);
        return;
      }
      projectCanvasLayout.scheduleNodeLayoutSave(node);
    },
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    projectId: uid,
    refreshWorkloadLists: refresh,
    selectionReady: !isEmptyGraphLoading,
  });
  const selectedTelemetryTarget = useMemo(
    () => telemetryTargetFromCanvasNode(workbench.selectedNode),
    [workbench.selectedNode]
  );
  const { openDrawerSurface, openMainSurface, openSideSurface } = workbench;
  const projectCanvasSidePaneSurface = useMemo<ProjectSidePaneAssistantSurface>(
    () => ({
      id: `project-canvas:${uid}`,
      openAssistantIntent: (intent) => {
        const surfaceIntent = projectCanvasEntryForAssistantIntent(intent, {
          projectId: uid,
        });
        if (surfaceIntent == null) {
          return { status: "ignored" as const };
        }
        if (surfaceIntent.slot === "drawer") {
          openDrawerSurface(surfaceIntent.entry);
          return { status: "handled" as const };
        }
        if (surfaceIntent.slot === "main") {
          openMainSurface(surfaceIntent.entry);
          return { status: "handled" as const };
        }
        openSideSurface(surfaceIntent.entry);
        return { status: "handled" as const };
      },
    }),
    [openDrawerSurface, openMainSurface, openSideSurface, uid]
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
  const canvasViewportInset =
    workbench.surfaceRenderModel.side == null
      ? 0
      : PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET;
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {frameState.renderCanvas && (
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
                {frameState.overlay === "loading" ? (
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
                {frameState.overlay === "error" ||
                frameState.overlay === "empty" ? (
                  <div
                    aria-live="polite"
                    className="pointer-events-none absolute top-6 left-1/2 z-10 -translate-x-1/2"
                    data-slot="project-canvas-empty-state"
                    role="status"
                  >
                    <div className="rounded-lg border border-border bg-card px-4 py-2 shadow-md">
                      <span className="font-medium text-foreground text-sm">
                        {frameState.overlay === "error"
                          ? "Workloads unavailable"
                          : "No workloads"}
                      </span>
                    </div>
                  </div>
                ) : null}
                <Canvas.Flow>
                  <Canvas.MiniMap rightInset={canvasViewportInset} />
                  <Canvas.Controls rightInset={canvasViewportInset} />
                  <ProjectCanvasWorkbenchSurfaces
                    kubeconfig={kubeconfig}
                    namespace={namespace}
                    projectId={uid}
                    refreshWorkloadLists={refresh}
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
