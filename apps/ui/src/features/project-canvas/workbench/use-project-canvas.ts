"use client";

import type { CanvasSelectedNode } from "@workspace/ui/components/canvas/canvas.types";
import type { Edge, Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import {
  createProjectCanvasDrawerRenderModel,
  createProjectCanvasMainRenderModel,
  createProjectCanvasSideRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import {
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
} from "@/features/project-canvas/surface/selection";
import {
  createProjectCanvasMeta,
  viewportFocusNodeIdFromSideRenderModel,
} from "@/features/project-canvas/workbench/canvas-meta";
import type { ProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/command-model";
import { deploymentTaskViewportFocusNodeIds } from "@/features/project-canvas/workbench/deployment-task-viewport-focus";
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
import type { ProjectRuntimeStore } from "@/features/project-runtime/resource-store";
import {
  createSettingsLaunchContextStore,
  type SettingsLaunchContext,
  type SettingsLaunchSource,
  type SettingsSurfaceEntry,
} from "@/features/project-runtime/settings-launch-context";
import type { ApEnvironmentDbReferenceSource } from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import { useSettingsLeaveGuardController } from "@/features/project-settings/settings-leave-guard-controller";
import type {
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/project-settings/settings-types";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

export interface UseProjectCanvasOptions {
  apEnvironmentDbReferenceSources?: ApEnvironmentDbReferenceSource[];
  deploymentTaskProjections?: readonly DeploymentTaskProjection[];
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
  runtimeStore?: ProjectRuntimeStore;
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
  const openSideRoute = workbenchRoute.openSide;
  const openMainSurface = workbenchRoute.openMain;
  const openDrawerSurface = workbenchRoute.openDrawer;
  const repairSide = workbenchRoute.repairSide;
  const closeSideRoute = workbenchRoute.closeSide;
  const closeMainRoute = workbenchRoute.closeMain;
  const closeDrawerRoute = workbenchRoute.closeDrawer;
  const clearCanvasFocus = workbenchRoute.clearCanvasFocus;
  const focusCanvasSelection = workbenchRoute.focusCanvasSelection;
  const settingsLaunchContextStore = useMemo(
    () => createSettingsLaunchContextStore(),
    []
  );
  const [, setSettingsLaunchContextRevision] = useState(0);
  const pendingDatabaseBindingIntentCounter = useRef(0);
  const bumpSettingsLaunchContextRevision = useCallback(() => {
    setSettingsLaunchContextRevision((revision) => revision + 1);
  }, []);
  const writeSettingsLaunchContext = useCallback(
    ({
      context,
      entry,
      slot,
    }: {
      context: SettingsLaunchContext;
      entry: SettingsSurfaceEntry;
      slot: "side";
    }) => {
      settingsLaunchContextStore.set({ context, entry, slot });
      bumpSettingsLaunchContextRevision();
    },
    [bumpSettingsLaunchContextRevision, settingsLaunchContextStore]
  );
  const [
    manuallyClosedDeploymentTaskTimelineTaskIds,
    setManuallyClosedDeploymentTaskTimelineTaskIds,
  ] = useState<ReadonlySet<string>>(() => new Set());
  const [
    deploymentTaskViewportFocusRequestKey,
    setDeploymentTaskViewportFocusRequestKey,
  ] = useState(0);
  const openSideSurface = useCallback(
    (
      entry: ProjectSideSurfaceEntry,
      canvasSelection?: ProjectCanvasSelection | null,
      launchSource: SettingsLaunchSource = "canvas",
      pendingDbReference?: NonNullable<
        ProjectCanvasCommandPlan["pendingDbReference"]
      >
    ) => {
      if (entry.kind === "deploymentTaskTimeline") {
        setManuallyClosedDeploymentTaskTimelineTaskIds((current) => {
          if (!current.has(entry.taskId)) {
            return current;
          }
          const next = new Set(current);
          next.delete(entry.taskId);
          return next;
        });
        openSideRoute(entry, canvasSelection, () => {
          setDeploymentTaskViewportFocusRequestKey((current) => current + 1);
        });
        return;
      }
      if (entry.kind === "settings") {
        openSideRoute(entry, canvasSelection, () => {
          const existing = settingsLaunchContextStore.get({
            entry,
            slot: "side",
          });
          const pendingDatabaseBindingIntent =
            pendingDbReference == null
              ? existing?.pendingDatabaseBindingIntent
              : {
                  dbName: pendingDbReference.dbName,
                  dbNamespace: pendingDbReference.dbNamespace,
                  id: `ap-db-${++pendingDatabaseBindingIntentCounter.current}`,
                };
          writeSettingsLaunchContext({
            context: {
              launchSource,
              ...(pendingDatabaseBindingIntent == null
                ? {}
                : { pendingDatabaseBindingIntent }),
            },
            entry,
            slot: "side",
          });
        });
        return;
      }
      openSideRoute(entry, canvasSelection);
    },
    [openSideRoute, settingsLaunchContextStore, writeSettingsLaunchContext]
  );
  const shouldAutoOpenDeploymentTaskTimeline = useCallback(
    (taskId: string) =>
      !manuallyClosedDeploymentTaskTimelineTaskIds.has(taskId),
    [manuallyClosedDeploymentTaskTimelineTaskIds]
  );

  useDeploymentTaskTimelineOpener({
    openSideSurface,
    projectId: options?.projectId,
    shouldOpenTask: shouldAutoOpenDeploymentTaskTimeline,
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

  const executeCommandPlan = useCallback(
    (plan: ProjectCanvasCommandPlan) => {
      const run = () => {
        executeUnguardedProjectCanvasCommandPlan(plan, {
          bringNodeToFront: bringNodeToFrontById,
          openDrawerSurface,
          openMainSurface,
          openSideSurface: (entry, selection) =>
            openSideSurface(
              entry,
              selection,
              "canvas",
              plan.pendingDbReference
            ),
          writeSelection,
        });
      };

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
    executeCommandPlan,
    nodes: stackOrderedNodes,
    onNodeExpansionChange: options?.onNodeExpansionChange,
    onPendingApDbReferencesStart: options?.onPendingApDbReferencesStart,
    readOnly,
    requestApDelete,
    requestDbDelete,
    resourceActions,
  });
  const nodes = decorated.nodes;
  const runtimeModelDecorators = decorated.runtimeModelDecorators;

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
  const sideSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasSideRenderModel({
        nodes,
        runtimeStore: options?.runtimeStore,
        surfaceState: {
          main: surfaceState.main,
          side: surfaceState.side,
        },
      }),
    [nodes, options?.runtimeStore, surfaceState.main, surfaceState.side]
  );
  const mainSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasMainRenderModel({
        entry: surfaceState.main,
        nodes,
        runtimeStore: options?.runtimeStore,
      }),
    [nodes, options?.runtimeStore, surfaceState.main]
  );
  const drawerSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasDrawerRenderModel({
        entry: surfaceState.drawer,
        nodes,
        runtimeStore: options?.runtimeStore,
      }),
    [nodes, options?.runtimeStore, surfaceState.drawer]
  );
  const surfaceRenderModel = useMemo(
    () => ({
      drawer: drawerSurfaceRenderModel,
      main: mainSurfaceRenderModel,
      side: sideSurfaceRenderModel,
    }),
    [drawerSurfaceRenderModel, mainSurfaceRenderModel, sideSurfaceRenderModel]
  );
  const activeSettingsEntry =
    surfaceState.side?.kind === "settings" ? surfaceState.side : null;

  useEffect(() => {
    if (activeSettingsEntry == null) {
      return;
    }
    if (
      settingsLaunchContextStore.get({
        entry: activeSettingsEntry,
        slot: "side",
      }) !== undefined
    ) {
      return;
    }
    settingsLaunchContextStore.setRouteRestored({
      entry: activeSettingsEntry,
      slot: "side",
    });
    bumpSettingsLaunchContextRevision();
  }, [
    activeSettingsEntry,
    bumpSettingsLaunchContextRevision,
    settingsLaunchContextStore,
  ]);

  const activeSettingsLaunchContext =
    activeSettingsEntry == null
      ? undefined
      : settingsLaunchContextStore.get({
          entry: activeSettingsEntry,
          slot: "side",
        });

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

  const activeDeploymentTaskTimelineTaskId =
    surfaceState.side?.kind === "deploymentTaskTimeline"
      ? surfaceState.side.taskId
      : null;
  const deploymentTaskFocusNodeIds = useMemo(
    () =>
      deploymentTaskViewportFocusNodeIds({
        nodes,
        taskId: activeDeploymentTaskTimelineTaskId,
        tasks: options?.deploymentTaskProjections ?? [],
      }),
    [
      activeDeploymentTaskTimelineTaskId,
      nodes,
      options?.deploymentTaskProjections,
    ]
  );
  const viewportFocusNodeIds = useMemo(() => {
    const sideNodeId = viewportFocusNodeIdFromSideRenderModel(
      surfaceRenderModel.side
    );
    if (sideNodeId != null) {
      return [sideNodeId];
    }
    if (restoredDbServiceViewportFocusNodeId != null) {
      return [restoredDbServiceViewportFocusNodeId];
    }
    return deploymentTaskFocusNodeIds;
  }, [
    deploymentTaskFocusNodeIds,
    restoredDbServiceViewportFocusNodeId,
    surfaceRenderModel.side,
  ]);
  const viewportFocusActive = useMemo(
    () =>
      surfaceRenderModel.side?.kind === "resource" ||
      activeDeploymentTaskTimelineTaskId !== null ||
      restoredDbServiceViewportFocusNodeId !== null,
    [
      activeDeploymentTaskTimelineTaskId,
      restoredDbServiceViewportFocusNodeId,
      surfaceRenderModel.side,
    ]
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
    const side = surfaceState.side;
    if (side?.kind === "deploymentTaskTimeline") {
      setManuallyClosedDeploymentTaskTimelineTaskIds((current) => {
        if (current.has(side.taskId)) {
          return current;
        }
        return new Set(current).add(side.taskId);
      });
    }
    if (side?.kind !== "settings") {
      closeSideRoute();
      return;
    }

    closeSideRoute(() => {
      settingsLaunchContextStore.delete({ entry: side, slot: "side" });
      bumpSettingsLaunchContextRevision();
    });
  }, [
    bumpSettingsLaunchContextRevision,
    closeSideRoute,
    settingsLaunchContextStore,
    surfaceState.side,
  ]);

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
  const settingsReadModelHints = useMemo<SettingsReadModelHints>(
    () => ({
      ap: {
        dbDsnReferenceSources: options?.apEnvironmentDbReferenceSources,
      },
    }),
    [options?.apEnvironmentDbReferenceSources]
  );
  const settingsSessionEvents = useMemo<
    SettingsSessionEvents | undefined
  >(() => {
    const side = surfaceRenderModel.side;
    if (side?.kind !== "resource" || side.content.kind !== "settings") {
      return undefined;
    }
    const target = side.content.target.target;
    if (target.kind !== "AP") {
      return undefined;
    }
    return {
      ap: decorated.apSettingsSessionEventsForAp({
        name: target.name,
        namespace: target.namespace,
      }),
    };
  }, [decorated, surfaceRenderModel.side]);
  const consumeSettingsLaunchContext = useCallback(() => {
    const entry = activeSettingsEntry;
    if (entry == null) {
      return;
    }
    const context = settingsLaunchContextStore.get({ entry, slot: "side" });
    if (context == null || context.pendingDatabaseBindingIntent == null) {
      return;
    }
    settingsLaunchContextStore.set({
      context: { launchSource: context.launchSource },
      entry,
      slot: "side",
    });
    bumpSettingsLaunchContextRevision();
  }, [
    activeSettingsEntry,
    bumpSettingsLaunchContextRevision,
    settingsLaunchContextStore,
  ]);

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
        projectId: options?.projectId,
        projectCanvasConnectionLine:
          connectionGesture.projectCanvasConnectionLine,
        readOnly,
        viewportFocusKey:
          activeDeploymentTaskTimelineTaskId == null
            ? undefined
            : `deployment-task:${activeDeploymentTaskTimelineTaskId}:${deploymentTaskViewportFocusRequestKey}`,
        viewportFocusActive,
        viewportFocusNodeIds,
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
      options?.projectId,
      readOnly,
      activeDeploymentTaskTimelineTaskId,
      deploymentTaskViewportFocusRequestKey,
      viewportFocusActive,
      viewportFocusNodeIds,
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
    runtimeModelDecorators,
    selected,
    selectedEdge,
    selectedNode,
    settingsLaunchContext: activeSettingsLaunchContext,
    settingsLeaveGuardDialog,
    settingsReadModelHints,
    settingsSessionEvents,
    consumeSettingsLaunchContext,
    surfaceRenderModel,
  };
}
