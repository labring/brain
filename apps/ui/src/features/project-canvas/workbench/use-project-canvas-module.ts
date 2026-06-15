"use client";

import type {
  CanvasMeta,
  CanvasState,
} from "@workspace/ui/components/canvas/canvas.types";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/features/project-canvas/flow/pending-connections";
import { isCanvasNodeGeneratedPosition } from "@/features/project-canvas/layout/placement";
import { resourcePlacementOwner } from "@/features/project-canvas/layout/placement-owner";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import { useProjectCanvasLayout } from "@/features/project-canvas/layout/use-project-canvas-layout";
import { isDeploymentPlaceholderNode } from "@/features/project-canvas/snapshot/deployment-placeholder-nodes";
import { deploymentProjectionPlacementNodesFromPlaceholderNode } from "@/features/project-canvas/snapshot/deployment-placement-commands";
import { useProjectCanvasResourceSnapshot } from "@/features/project-canvas/snapshot/use-project-canvas-resource-snapshot";
import { telemetryTargetFromCanvasNode } from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET } from "@/features/project-canvas/workbench/canvas-meta";
import type { ProjectCanvasSurfaceHostActions } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvas } from "@/features/project-canvas/workbench/use-project-canvas";
import type { ProjectSurfaceIntent } from "@/features/project-surfaces/surface-state";

export function useProjectCanvasModule({
  kubeconfig,
  namespace,
  projectId,
}: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}) {
  const [pendingApDbReferences, setPendingApDbReferences] = useState<
    PendingApDbCanvasReference[]
  >([]);
  const projectCanvasLayout = useProjectCanvasLayout({
    enabled: kubeconfig.trim() !== "",
    kubeconfig,
    namespace,
    projectId,
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
    uid: projectId,
  });

  useEffect(() => {
    if (resourceSnapshotLoading || layoutIntent == null) {
      return;
    }
    if (layoutIntent.kind === "placement-commands") {
      projectCanvasLayout
        .savePlacementCommands(layoutIntent.commands, {
          expectedVersion: layoutIntent.expectedVersion,
        })
        .catch(() => undefined);
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
    projectCanvasLayout.savePlacementCommands,
    resourceSnapshotLoading,
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
  }, [namespace, projectId]);

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

  const deleteResourceLayoutRefs = useCallback(
    (refs: readonly CanvasLayoutResourceRef[]) => {
      const commands = refs.map((ref) => ({
        kind: "delete" as const,
        owner: resourcePlacementOwner(ref),
      }));
      projectCanvasLayout
        .savePlacementCommands(commands)
        .catch(() => undefined);
    },
    [projectCanvasLayout.savePlacementCommands]
  );

  const onNodePositionChange = useCallback(
    (
      node: Parameters<typeof projectCanvasLayout.scheduleNodeLayoutSave>[0]
    ) => {
      if (isDeploymentPlaceholderNode(node)) {
        const placementNodes =
          deploymentProjectionPlacementNodesFromPlaceholderNode({
            node,
            nodes: canvasState.nodes,
            source: "user",
          });
        if (placementNodes.length > 0) {
          projectCanvasLayout
            .saveLayoutNodes(placementNodes)
            .catch(() => undefined);
        }
        return;
      }
      projectCanvasLayout.scheduleNodeLayoutSave(node, { source: "user" });
    },
    [
      canvasState.nodes,
      projectCanvasLayout.saveLayoutNodes,
      projectCanvasLayout.scheduleNodeLayoutSave,
    ]
  );

  const workbench = useProjectCanvas(canvasState.nodes, {
    apEnvironmentDbReferenceSources,
    edges: canvasEdges,
    kubeconfig,
    namespace,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange,
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    onResourceLayoutDelete: deleteResourceLayoutRefs,
    projectId,
    refreshWorkloadLists: refresh,
    selectionReady: !isEmptyGraphLoading,
  });

  const openingKey = `${namespace}:${projectId}`;
  const meta = useMemo<CanvasMeta>(
    () => ({
      ...workbench.meta,
      openingFitView: {
        key: openingKey,
      },
      viewportFollow: {
        isFollowTarget: isCanvasNodeGeneratedPosition,
        key: openingKey,
      },
    }),
    [workbench.meta, openingKey]
  );

  const state = useMemo<CanvasState>(
    () => ({
      ...canvasState,
      connectionOrigin: workbench.connectionOrigin,
      edges: canvasEdges,
      nodes: workbench.nodes,
      selectedEdge: workbench.selectedEdge,
      selectedNode: workbench.selectedNode,
    }),
    [
      canvasEdges,
      canvasState,
      workbench.connectionOrigin,
      workbench.nodes,
      workbench.selectedEdge,
      workbench.selectedNode,
    ]
  );

  const selectedTelemetryTarget = useMemo(
    () => telemetryTargetFromCanvasNode(workbench.selectedNode),
    [workbench.selectedNode]
  );

  const surfaceActions = useMemo<ProjectCanvasSurfaceHostActions>(
    () => ({
      closeDrawerSurface: workbench.closeDrawerSurface,
      closeMainSurface: workbench.closeMainSurface,
      closeResourceLogsSurface: workbench.closeResourceLogsSurface,
      closeResourcePane: workbench.closeResourcePane,
      onDbServiceRestoreAccepted: workbench.onDbServiceRestoreAccepted,
      registerSettingsLeaveGuard: workbench.registerSettingsLeaveGuard,
      repairSide: workbench.repairSide,
    }),
    [
      workbench.closeDrawerSurface,
      workbench.closeMainSurface,
      workbench.closeResourceLogsSurface,
      workbench.closeResourcePane,
      workbench.onDbServiceRestoreAccepted,
      workbench.registerSettingsLeaveGuard,
      workbench.repairSide,
    ]
  );

  const openSurfaceIntent = useCallback(
    (intent: ProjectSurfaceIntent) => {
      if (intent.slot === "drawer") {
        workbench.openDrawerSurface(intent.entry);
        return;
      }
      if (intent.slot === "main") {
        workbench.openMainSurface(intent.entry);
        return;
      }
      workbench.openSideSurface(intent.entry);
    },
    [
      workbench.openDrawerSurface,
      workbench.openMainSurface,
      workbench.openSideSurface,
    ]
  );

  const viewportInset =
    workbench.surfaceRenderModel.side == null
      ? 0
      : PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET;

  return {
    actions: {
      openSurfaceIntent,
    },
    canvas: {
      frameState,
      meta,
      selectedTelemetryTarget,
      state,
      viewportInset,
    },
    surfaces: {
      actions: surfaceActions,
      dialogs: [
        workbench.settingsLeaveGuardDialog,
        workbench.resourceDeleteDialog,
      ],
      model: workbench.surfaceRenderModel,
      refreshWorkloadLists: refresh,
    },
  };
}
