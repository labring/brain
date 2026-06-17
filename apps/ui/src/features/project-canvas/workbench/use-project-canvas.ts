"use client";

import type { CanvasSelectedNode } from "@workspace/ui/components/canvas/canvas.types";
import type { Edge, Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import { createProjectCanvasSurfaceRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import {
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
} from "@/features/project-canvas/surface/selection";
import {
  createProjectCanvasMeta,
  sideRenderModelHasViewportFocusSession,
  viewportFocusNodeIdFromSideRenderModel,
} from "@/features/project-canvas/workbench/canvas-meta";
import type { ProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/command-model";
import { executeUnguardedProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/project-canvas-command-executor";
import { useDbServiceRestoreFocus } from "@/features/project-canvas/workbench/use-db-service-restore-focus";
import { useDeploymentTaskTimelineOpener } from "@/features/project-canvas/workbench/use-deployment-task-timeline-opener";
import { useProjectCanvasConnectionGesture } from "@/features/project-canvas/workbench/use-project-canvas-connection-gesture";
import { useProjectCanvasNodeDecorators } from "@/features/project-canvas/workbench/use-project-canvas-node-decorators";
import { useProjectCanvasStackOrder } from "@/features/project-canvas/workbench/use-project-canvas-stack-order";
import { useResourceDeleteDialogs } from "@/features/project-canvas/workbench/use-resource-delete-dialogs";
import { useProjectResourceActions } from "@/features/project-resource-actions/resource-actions";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import { useProjectWorkbenchRouteState } from "@/features/project-route-state/use-project-workbench-route-state";
import type { ApEnvironmentDbReferenceSource } from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import { useSettingsLeaveGuardController } from "@/features/project-settings/settings-leave-guard-controller";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

export interface UseProjectCanvasOptions {
  apEnvironmentDbReferenceSources?: ApEnvironmentDbReferenceSource[];
  edges?: Edge[];
  kubeconfig?: string;
  namespace?: string;
  onNodeExpansionChange?: (node: Node) => void;
  onNodePositionChange?: (node: Node) => void;
  onNodeStackOrderChange?: (node: Node) => void;
  onPendingApDbReferencesStart?: (
    references: readonly PendingApDbCanvasReference[]
  ) => (() => void) | undefined;
  onResourceLayoutDelete?: (refs: readonly CanvasLayoutResourceRef[]) => void;
  projectId?: string;
  readOnly?: boolean;
  /** Refetch workload list(s) after PATCH/POST/DELETE lifecycle calls. */
  refreshWorkloadLists?: () => Promise<unknown>;
  /** True when the resource lists have settled enough to clear stale URL selections. */
  selectionReady?: boolean;
}

function sideEntrySupportedForProject(
  entry: ProjectSideSurfaceEntry,
  projectId: string | undefined
) {
  if (entry.kind === "projectCreation") {
    return false;
  }
  if (
    (entry.kind === "databaseDeployment" ||
      entry.kind === "deploymentTaskTimeline" ||
      entry.kind === "dockerDeployment" ||
      entry.kind === "githubDeployment" ||
      entry.kind === "templateDeployment") &&
    projectId != null
  ) {
    return entry.projectId === projectId;
  }
  return true;
}

/**
 * Composes project route state, node adapters, resource actions, and canvas
 * interaction metadata for `<Canvas.Root />`.
 */
export function useProjectCanvas(
  rawNodes: Node[],
  options?: UseProjectCanvasOptions
) {
  const readOnly = options?.readOnly === true;
  const selectionReady = options?.selectionReady ?? rawNodes.length > 0;
  const routingDomain = useMemo(
    () =>
      readOnly ? "" : routingDomainFromKubeconfig(options?.kubeconfig ?? ""),
    [options?.kubeconfig, readOnly]
  );
  const {
    registerSettingsLeaveGuard,
    requestSettingsLeave,
    settingsLeaveGuardDialog,
  } = useSettingsLeaveGuardController();

  const canvasSelectionExists = useCallback(
    (selection: ProjectCanvasSelection) => {
      if (selection.kind === "edge") {
        const edges = options?.edges ?? [];
        return (
          edges.length === 0 ||
          edges.some((edge) => edge.id === selection.edgeId)
        );
      }
      return projectSelectionTargetExists(rawNodes, selection);
    },
    [options?.edges, rawNodes]
  );

  const targetExists = useCallback(
    (target: Parameters<typeof projectTargetExistsOnCanvas>[1]) =>
      projectTargetExistsOnCanvas(rawNodes, target),
    [rawNodes]
  );

  const isSideEntrySupported = useCallback(
    (entry: ProjectSideSurfaceEntry) =>
      sideEntrySupportedForProject(entry, options?.projectId),
    [options?.projectId]
  );

  const workbenchRoute = useProjectWorkbenchRouteState({
    canvasSelectionExists,
    isSideEntrySupported,
    requestSidePaneLeave: requestSettingsLeave,
    selectionReady,
    targetExists,
  });
  const selected = workbenchRoute.canvasSelection;
  const surfaceState = workbenchRoute.surfaces;
  const writeSelection = workbenchRoute.writeCanvasSelection;
  const openSideSurface = workbenchRoute.openSide;
  const openMainSurface = workbenchRoute.openMain;
  const openDrawerSurface = workbenchRoute.openDrawer;
  const repairSide = workbenchRoute.repairSide;
  const closeSideRoute = workbenchRoute.closeSide;
  const closeMainRoute = workbenchRoute.closeMain;
  const closeDrawerRoute = workbenchRoute.closeDrawer;
  const clearCanvasFocus = workbenchRoute.clearCanvasFocus;
  const focusCanvasSelection = workbenchRoute.focusCanvasSelection;

  useDeploymentTaskTimelineOpener({
    openSideSurface,
    projectId: options?.projectId,
  });

  const resourceActions = useProjectResourceActions({
    kubeconfig: options?.kubeconfig,
    readOnly,
    refreshWorkloadLists: options?.refreshWorkloadLists,
    routingDomain,
  });

  const { bringNodeToFrontById, frontCanvasNode, stackOrderedNodes } =
    useProjectCanvasStackOrder({
      nodes: rawNodes,
      onNodeStackOrderChange: options?.onNodeStackOrderChange,
      readOnly,
    });

  const { requestApDelete, requestDbDelete, resourceDeleteDialog } =
    useResourceDeleteDialogs({
      deleteApWorkload: resourceActions.apLifecycle.deleteWorkload,
      deleteDbWorkload: resourceActions.dbLifecycle.deleteWorkload,
      onResourceLayoutDelete: options?.onResourceLayoutDelete,
      runResourceAction: resourceActions.runResourceAction,
    });

  const startPendingDbReferenceRef = useRef<
    (
      reference: NonNullable<ProjectCanvasCommandPlan["pendingDbReference"]>
    ) => void
  >(() => undefined);

  const executeCommandPlan = useCallback(
    (plan: ProjectCanvasCommandPlan) => {
      const run = () =>
        executeUnguardedProjectCanvasCommandPlan(plan, {
          bringNodeToFront: bringNodeToFrontById,
          openDrawerSurface,
          openMainSurface,
          openSideSurface,
          startPendingDbReference: (reference) =>
            startPendingDbReferenceRef.current(reference),
          writeSelection,
        });

      if (plan.guard?.kind === "settingsLeave") {
        requestSettingsLeave(plan.guard.action, run);
        return;
      }

      run();
    },
    [
      bringNodeToFrontById,
      openDrawerSurface,
      openMainSurface,
      openSideSurface,
      requestSettingsLeave,
      writeSelection,
    ]
  );

  const decorated = useProjectCanvasNodeDecorators({
    apEnvironmentDbReferenceSources: options?.apEnvironmentDbReferenceSources,
    executeCommandPlan,
    nodes: stackOrderedNodes,
    onNodeExpansionChange: options?.onNodeExpansionChange,
    onPendingApDbReferencesStart: options?.onPendingApDbReferencesStart,
    readOnly,
    requestApDelete,
    requestDbDelete,
    resourceActions,
  });
  startPendingDbReferenceRef.current = decorated.startPendingDbReference;
  const nodes = decorated.nodes;

  const selectedNode = useMemo<CanvasSelectedNode>(
    () => projectSelectionNode(nodes, selected),
    [nodes, selected]
  );
  const selectedEdge = useMemo(
    () =>
      selected?.kind === "edge"
        ? ((options?.edges ?? []).find((edge) => edge.id === selected.edgeId) ??
          null)
        : null,
    [options?.edges, selected]
  );
  const surfaceRenderModel = useMemo(
    () =>
      createProjectCanvasSurfaceRenderModel({
        nodes,
        surfaceState,
      }),
    [nodes, surfaceState]
  );

  const {
    clearRestoredDbServiceViewportFocus,
    onDbServiceRestoreAccepted,
    restoredDbServiceViewportFocusNodeId,
  } = useDbServiceRestoreFocus({
    focusCanvasSelection,
    mainSurface: surfaceState.main,
    nodes,
    refreshWorkloadLists: options?.refreshWorkloadLists,
  });

  const viewportFocusNodeId = useMemo(
    () =>
      viewportFocusNodeIdFromSideRenderModel(surfaceRenderModel.side) ??
      restoredDbServiceViewportFocusNodeId,
    [restoredDbServiceViewportFocusNodeId, surfaceRenderModel.side]
  );
  const viewportFocusActive = useMemo(
    () =>
      sideRenderModelHasViewportFocusSession(surfaceRenderModel.side) ||
      restoredDbServiceViewportFocusNodeId !== null,
    [restoredDbServiceViewportFocusNodeId, surfaceRenderModel.side]
  );

  useEffect(() => {
    if (selectedNode == null) {
      return;
    }
    frontCanvasNode(selectedNode);
  }, [frontCanvasNode, selectedNode]);

  const connectionGesture = useProjectCanvasConnectionGesture({
    executeCommandPlan,
    nodes,
    readOnly,
  });

  const closeSideSurface = useCallback(() => {
    closeSideRoute();
  }, [closeSideRoute]);

  const closeMainSurface = useCallback(() => {
    closeMainRoute();
  }, [closeMainRoute]);

  const closeDrawerSurface = useCallback(() => {
    closeDrawerRoute();
  }, [closeDrawerRoute]);

  const clearSelection = useCallback(() => {
    clearRestoredDbServiceViewportFocus();
    clearCanvasFocus();
  }, [clearCanvasFocus, clearRestoredDbServiceViewportFocus]);

  const requestResourcePaneReplacement = useCallback(
    (continueReplace: () => void) => {
      requestSettingsLeave("switch", continueReplace);
    },
    [requestSettingsLeave]
  );

  const closeResourcePane = closeSideSurface;
  const closeResourceLogsSurface = closeMainSurface;

  const meta = useMemo(
    () =>
      createProjectCanvasMeta({
        clearSelection,
        connectionGestureActive: connectionGesture.connectionGestureActive,
        executeCommandPlan,
        focusCanvasSelection,
        frontCanvasNode,
        handleConnect: connectionGesture.handleConnect,
        handleConnectEnd: connectionGesture.handleConnectEnd,
        handleConnectStart: connectionGesture.handleConnectStart,
        isValidCanvasConnection: connectionGesture.isValidCanvasConnection,
        nodes,
        onNodePositionChange: options?.onNodePositionChange,
        projectCanvasConnectionLine:
          connectionGesture.projectCanvasConnectionLine,
        readOnly,
        viewportFocusActive,
        viewportFocusNodeId,
      }),
    [
      clearSelection,
      connectionGesture.connectionGestureActive,
      connectionGesture.handleConnect,
      connectionGesture.handleConnectEnd,
      connectionGesture.handleConnectStart,
      connectionGesture.isValidCanvasConnection,
      connectionGesture.projectCanvasConnectionLine,
      executeCommandPlan,
      focusCanvasSelection,
      frontCanvasNode,
      nodes,
      options?.onNodePositionChange,
      readOnly,
      viewportFocusActive,
      viewportFocusNodeId,
    ]
  );

  return {
    clearSelection,
    closeDrawerSurface,
    closeMainSurface,
    closeResourceLogsSurface,
    closeResourcePane,
    closeSideSurface,
    connectionOrigin: connectionGesture.connectionOrigin,
    meta,
    nodes,
    onDbServiceRestoreAccepted,
    openDrawerSurface,
    openMainSurface,
    openSideSurface,
    resourceDeleteDialog,
    registerSettingsLeaveGuard,
    repairSide,
    requestResourcePaneReplacement,
    selected,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    surfaceRenderModel,
  };
}
