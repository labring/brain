"use client";

import type { CanvasSelectedNode } from "@workspace/ui/components/canvas/canvas.types";
import type { Edge, Node } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import { useProjectWorkbenchRouteState } from "@/features/panes/use-project-workbench-route-state";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import { autoLayoutCanvasNodes } from "@/features/project-canvas/layout/auto-layout";
import type {
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
} from "@/features/project-canvas/layout/types";
import { interactionSnapshotFromCanvasState } from "@/features/project-canvas/surface/interaction-react";
import { createProjectCanvasInteractionStore } from "@/features/project-canvas/surface/interaction-store";
import {
  createProjectCanvasDrawerRenderModel,
  createProjectCanvasMainRenderModel,
  createProjectCanvasSideRenderModel,
  type ProjectCanvasSideRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import {
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
} from "@/features/project-canvas/surface/selection";
import {
  createProjectCanvasMeta,
  projectCanvasViewportFocusRequest,
  viewportFocusNodeIdFromSideRenderModel,
} from "@/features/project-canvas/workbench/canvas-meta";
import type { ProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/command-model";
import { createCanvasLifecycleActivityStore } from "@/features/project-canvas/workbench/lifecycle-activity-store";
import type { ProjectCanvasNodeCommands } from "@/features/project-canvas/workbench/node-commands-react";
import { executeUnguardedProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/project-canvas-command-executor";
import { createProjectCanvasFlowStore } from "@/features/project-canvas/workbench/project-canvas-flow-store";
import { useApSettingsSessionEvents } from "@/features/project-canvas/workbench/use-ap-settings-session-events";
import { useDbServiceRestoreFocus } from "@/features/project-canvas/workbench/use-db-service-restore-focus";
import { useDeploymentTaskTimelineOpener } from "@/features/project-canvas/workbench/use-deployment-task-timeline-opener";
import { useProjectCanvasConnectionGesture } from "@/features/project-canvas/workbench/use-project-canvas-connection-gesture";
import { useProjectCanvasStackOrder } from "@/features/project-canvas/workbench/use-project-canvas-stack-order";
import { useResourceDeleteDialogs } from "@/features/project-canvas/workbench/use-resource-delete-dialogs";
import { useResourceLifecycleDialogs } from "@/features/project-canvas/workbench/use-resource-lifecycle-dialogs";
import { createProjectCanvasViewportDirectiveStore } from "@/features/project-canvas/workbench/viewport-directive-store";
import { useProjectResourceActions } from "@/features/project-resource-actions/resource-actions";
import type { ProjectRuntimeStore } from "@/features/project-runtime/resource-store";
import {
  createSettingsLaunchContextStore,
  type SettingsLaunchContext,
  type SettingsLaunchSource,
  type SettingsSurfaceEntry,
} from "@/features/project-runtime/settings-launch-context";
import type { ApEnvironmentDbReferenceSource } from "@/features/resource-settings/ap/k8s/db-dsn-reference-sources";
import { useSettingsLeaveGuardController } from "@/features/resource-settings/settings-leave-guard-controller";
import type {
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/resource-settings/settings-types";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { useStableCallback } from "@/lib/use-stable-callback";

export interface ProjectCanvasSideViewportFocus {
  active?: boolean;
  key?: number | string;
  nodeIds: readonly string[];
}

export type ProjectCanvasSideViewportFocusResolver = (input: {
  nodes: readonly Node[];
  requestKey: number;
  side: ProjectCanvasSideRenderModel;
}) => ProjectCanvasSideViewportFocus | null | undefined;

export interface UseProjectCanvasOptions {
  apEnvironmentDbReferenceSources?: ApEnvironmentDbReferenceSource[];
  edges?: Edge[];
  kubeconfig?: string;
  namespace?: string;
  /** Persist regenerated Canvas Layout entries after an Auto layout gesture. */
  onCanvasAutoLayout?: (nodes: CanvasLayoutNode[]) => void;
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
  sideViewportFocus?: ProjectCanvasSideViewportFocusResolver;
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
  const [sideViewportFocusRequestKey, setSideViewportFocusRequestKey] =
    useState(0);
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
          setSideViewportFocusRequestKey((current) => current + 1);
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
  const {
    requestApRestart,
    requestApStop,
    requestDbRestart,
    requestDbStop,
    resourceLifecycleDialogs,
  } = useResourceLifecycleDialogs({
    restartApWorkload: resourceActions.apLifecycle.restartWorkload,
    restartDbWorkload: resourceActions.dbLifecycle.restartWorkload,
    runResourceAction: resourceActions.runResourceAction,
    stopApWorkload: resourceActions.apLifecycle.pauseWorkload,
    stopDbWorkload: resourceActions.dbLifecycle.stopWorkload,
  });

  const executeCommandPlan = useStableCallback(
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
    }
  );

  const nodes = stackOrderedNodes;
  const getNodes = useStableCallback((): readonly Node[] => nodes);
  const flowStore = useMemo(() => createProjectCanvasFlowStore(), []);
  const optionEdges = options?.edges;
  useLayoutEffect(() => {
    flowStore.reconcile({ edges: optionEdges ?? [], nodes });
  }, [flowStore, nodes, optionEdges]);

  const autoLayoutCanvas = useStableCallback(() => {
    if (readOnly) {
      return;
    }
    const snapshot = flowStore.getSnapshot();
    if (snapshot.nodes.length === 0) {
      return;
    }
    const relationships = options?.runtimeStore?.selectRelationshipIndexes();
    const { layoutNodes, positionChanges } = autoLayoutCanvasNodes({
      connections:
        relationships === undefined
          ? []
          : [...relationships.publicAccessToAp, ...relationships.apToDb],
      nodes: snapshot.nodes,
    });
    if (positionChanges.length > 0) {
      flowStore.applyNodeChanges(positionChanges);
    }
    if (layoutNodes.length > 0) {
      options?.onCanvasAutoLayout?.(layoutNodes);
    }
  });

  const { apSettingsSessionEventsForAp } = useApSettingsSessionEvents({
    onPendingApDbReferencesStart: options?.onPendingApDbReferencesStart,
  });

  const persistNodeLayout = useStableCallback((node: Node) => {
    options?.onNodeExpansionChange?.(node);
  });
  const runResourceAction = useStableCallback(
    resourceActions.runResourceAction
  );
  const toggleDatabasePublicAccess = useStableCallback(
    resourceActions.toggleDatabasePublicAccess
  );
  const copyDatabaseConnection = useStableCallback(
    resourceActions.copyDatabaseConnection
  );
  const startApWorkload = useStableCallback(
    resourceActions.apLifecycle.startWorkload
  );
  const startDbWorkload = useStableCallback(
    resourceActions.dbLifecycle.startWorkload
  );
  const clearDbPublicAccessPendingTarget = useStableCallback(
    resourceActions.dbLifecycle.clearPublicAccessPendingTarget
  );

  const nodeCommands = useMemo<ProjectCanvasNodeCommands>(
    () => ({
      clearDbPublicAccessPendingTarget,
      copyDatabaseConnection,
      executeCommandPlan,
      getNodes,
      persistNodeLayout,
      projectId: options?.projectId,
      readOnly,
      requestApDelete,
      requestApRestart,
      requestApStop,
      requestDbDelete,
      requestDbRestart,
      requestDbStop,
      runResourceAction,
      startApWorkload,
      startDbWorkload,
      toggleDatabasePublicAccess,
    }),
    [
      clearDbPublicAccessPendingTarget,
      copyDatabaseConnection,
      executeCommandPlan,
      getNodes,
      persistNodeLayout,
      options?.projectId,
      readOnly,
      requestApDelete,
      requestApRestart,
      requestApStop,
      requestDbDelete,
      requestDbRestart,
      requestDbStop,
      runResourceAction,
      startApWorkload,
      startDbWorkload,
      toggleDatabasePublicAccess,
    ]
  );

  const lifecycleActivityStore = useMemo(
    () => createCanvasLifecycleActivityStore(),
    []
  );
  const apAuthReady = resourceActions.apLifecycle.authReady;
  const dbAuthReady = resourceActions.dbLifecycle.authReady;
  const getDbPublicAccessPendingTarget =
    resourceActions.dbLifecycle.getPublicAccessPendingTarget;
  const isDbLifecycleLoading = resourceActions.dbLifecycle.isLoading;
  useLayoutEffect(() => {
    lifecycleActivityStore.publish({
      apAuthReady,
      dbAuthReady,
      getDbPublicAccessPendingTarget,
      isDbLifecycleLoading,
    });
  }, [
    apAuthReady,
    dbAuthReady,
    getDbPublicAccessPendingTarget,
    isDbLifecycleLoading,
    lifecycleActivityStore,
  ]);

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

  const sideViewportFocus = useMemo(
    () =>
      options?.sideViewportFocus?.({
        nodes,
        requestKey: sideViewportFocusRequestKey,
        side: surfaceRenderModel.side,
      }) ?? null,
    [
      nodes,
      options?.sideViewportFocus,
      sideViewportFocusRequestKey,
      surfaceRenderModel.side,
    ]
  );
  const sideViewportFocusActive =
    sideViewportFocus == null
      ? false
      : (sideViewportFocus.active ?? sideViewportFocus.nodeIds.length > 0);
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
    return sideViewportFocus?.nodeIds ?? [];
  }, [
    restoredDbServiceViewportFocusNodeId,
    sideViewportFocus,
    surfaceRenderModel.side,
  ]);
  const viewportFocusActive = useMemo(
    () =>
      surfaceRenderModel.side?.kind === "resource" ||
      sideViewportFocusActive ||
      restoredDbServiceViewportFocusNodeId !== null,
    [
      restoredDbServiceViewportFocusNodeId,
      sideViewportFocusActive,
      surfaceRenderModel.side,
    ]
  );
  const viewportDirectives = useMemo(
    () => createProjectCanvasViewportDirectiveStore(),
    []
  );
  const sideViewportFocusKey = sideViewportFocus?.key;
  useLayoutEffect(() => {
    viewportDirectives.setFocus(
      projectCanvasViewportFocusRequest({
        active: viewportFocusActive,
        key: sideViewportFocusKey,
        nodeIds: viewportFocusNodeIds,
      })
    );
  }, [
    sideViewportFocusKey,
    viewportDirectives,
    viewportFocusActive,
    viewportFocusNodeIds,
  ]);

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

  const interactionStore = useMemo(
    () => createProjectCanvasInteractionStore(),
    []
  );
  const connectionOrigin = connectionGesture.connectionOrigin;
  useLayoutEffect(() => {
    interactionStore.setSnapshot(
      interactionSnapshotFromCanvasState({
        connectionOrigin,
        selectedEdge,
        selectedNode,
      })
    );
  }, [connectionOrigin, interactionStore, selectedEdge, selectedNode]);
  useLayoutEffect(() => {
    flowStore.setSelectedEdgeId(selectedEdge?.id ?? null);
  }, [flowStore, selectedEdge]);

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
      ap: apSettingsSessionEventsForAp({
        name: target.name,
        namespace: target.namespace,
      }),
    };
  }, [apSettingsSessionEventsForAp, surfaceRenderModel.side]);
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
        flowStore,
        focusCanvasSelection,
        frontCanvasNode,
        getNodes,
        handleConnect: connectionGesture.handleConnect,
        handleConnectEnd: connectionGesture.handleConnectEnd,
        handleConnectStart: connectionGesture.handleConnectStart,
        isValidCanvasConnection: connectionGesture.isValidCanvasConnection,
        onNodePositionChange: options?.onNodePositionChange,
        projectId: options?.projectId,
        projectCanvasConnectionLine:
          connectionGesture.projectCanvasConnectionLine,
        readOnly,
        viewportDirectives,
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
      flowStore,
      focusCanvasSelection,
      frontCanvasNode,
      getNodes,
      options?.onNodePositionChange,
      options?.projectId,
      readOnly,
      viewportDirectives,
    ]
  );

  return {
    autoLayoutCanvas,
    clearSelection,
    closeDrawerSurface,
    closeMainSurface,
    closeResourceLogsSurface,
    closeResourcePane,
    closeSideSurface,
    connectionOrigin: connectionGesture.connectionOrigin,
    interactionStore,
    lifecycleActivityStore,
    meta,
    nodeCommands,
    nodes,
    onDbServiceRestoreAccepted,
    openDrawerSurface,
    openMainSurface,
    openSideSurface,
    resourceDeleteDialog,
    resourceLifecycleDialogs,
    registerSettingsLeaveGuard,
    repairSide,
    requestResourcePaneReplacement,
    selected,
    selectedEdge,
    selectedNode,
    settingsLaunchContext: activeSettingsLaunchContext,
    settingsLeaveGuardDialog,
    settingsReadModelHints,
    settingsSessionEvents,
    consumeSettingsLaunchContext,
    surfaceRenderModel,
    viewportDirectives,
  };
}
