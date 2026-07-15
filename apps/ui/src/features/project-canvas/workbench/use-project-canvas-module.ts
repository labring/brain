"use client";

import type { CanvasSelectedNode } from "@workspace/ui/components/canvas/canvas.types";
import { isEffectivelyVisible } from "@workspace/ui/lib/effective-visibility";
import type { Node } from "@xyflow/react";
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type {
  ProjectSideSurfaceEntry,
  ProjectSurfaceIntent,
} from "@/features/panes/surface-state";
import { useProjectWorkbenchRouteState } from "@/features/panes/use-project-workbench-route-state";
import { useProjectResourceActions } from "@/features/project-canvas/actions/resource-actions";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/features/project-canvas/flow/pending-connections";
import { autoLayoutCanvasNodes } from "@/features/project-canvas/layout/auto-layout";
import { isCanvasNodeGeneratedPosition } from "@/features/project-canvas/layout/placement";
import { resourcePlacementOwner } from "@/features/project-canvas/layout/placement-owner";
import type {
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
} from "@/features/project-canvas/layout/types";
import { useProjectCanvasLayout } from "@/features/project-canvas/layout/use-project-canvas-layout";
import {
  createSettingsLaunchContextStore,
  type SettingsLaunchContext,
  type SettingsLaunchSource,
  type SettingsSurfaceEntry,
} from "@/features/project-canvas/runtime/settings-launch-context";
import { isDeploymentPlaceholderNode } from "@/features/project-canvas/snapshot/deployment-placeholder-nodes";
import { deploymentProjectionPlacementNodeFromUserDrag } from "@/features/project-canvas/snapshot/deployment-user-placement";
import { deploymentTaskViewportFocusNodeIds } from "@/features/project-canvas/snapshot/deployment-viewport-focus";
import { useProjectCanvasResourceSnapshot } from "@/features/project-canvas/snapshot/use-project-canvas-resource-snapshot";
import { interactionSnapshotFromCanvasState } from "@/features/project-canvas/surface/interaction-react";
import { createProjectCanvasInteractionStore } from "@/features/project-canvas/surface/interaction-store";
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
import { useStableCallback } from "@/features/project-canvas/use-stable-callback";
import {
  createProjectCanvasMeta,
  projectCanvasViewportFocusRequest,
  viewportFocusNodeIdFromSideRenderModel,
} from "@/features/project-canvas/workbench/canvas-meta";
import type { ProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/command-model";
import {
  deploymentTaskDockDismissalsStorageKey,
  readBrowserDeploymentTaskDockDismissals,
  writeBrowserDeploymentTaskDockDismissals,
} from "@/features/project-canvas/workbench/deployment-task-dock-dismissals";
import {
  DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_MS,
  selectDeploymentTaskDock,
} from "@/features/project-canvas/workbench/deployment-task-timeline-reentry";
import { createCanvasLifecycleActivityStore } from "@/features/project-canvas/workbench/lifecycle-activity-store";
import type { ProjectCanvasNodeCommands } from "@/features/project-canvas/workbench/node-commands-react";
import { executeUnguardedProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/project-canvas-command-executor";
import { createProjectCanvasFlowStore } from "@/features/project-canvas/workbench/project-canvas-flow-store";
import type { ProjectCanvasSurfaceHostActions } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useApSettingsSessionEvents } from "@/features/project-canvas/workbench/use-ap-settings-session-events";
import { useDbServiceRestoreFocus } from "@/features/project-canvas/workbench/use-db-service-restore-focus";
import { useDeploymentTaskTimelineOpener } from "@/features/project-canvas/workbench/use-deployment-task-timeline-opener";
import { useProjectCanvasConnectionGesture } from "@/features/project-canvas/workbench/use-project-canvas-connection-gesture";
import { useProjectCanvasStackOrder } from "@/features/project-canvas/workbench/use-project-canvas-stack-order";
import { useResourceDeleteDialogs } from "@/features/project-canvas/workbench/use-resource-delete-dialogs";
import { useResourceLifecycleDialogs } from "@/features/project-canvas/workbench/use-resource-lifecycle-dialogs";
import { createProjectCanvasViewportDirectiveStore } from "@/features/project-canvas/workbench/viewport-directive-store";
import { useSettingsLeaveGuardController } from "@/features/resource-settings/settings-leave-guard-controller";
import type {
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/resource-settings/settings-types";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

const DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_SOURCE_STATUSES = new Set<
  DeploymentTaskProjection["status"]
>(["applying", "blocked", "queued", "running"]);

function deploymentTaskCanStartCompletionNotice(
  previousStatus: DeploymentTaskProjection["status"] | undefined
): boolean {
  return (
    previousStatus !== undefined &&
    DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_SOURCE_STATUSES.has(previousStatus)
  );
}

function currentPageVisible(): boolean {
  return isEffectivelyVisible();
}

function pruneExpiredCompletionNotices(
  notices: ReadonlyMap<string, number>,
  now: number
): ReadonlyMap<string, number> {
  let changed = false;
  const next = new Map<string, number>();
  for (const [taskId, expiresAt] of notices) {
    if (expiresAt <= now) {
      changed = true;
      continue;
    }
    next.set(taskId, expiresAt);
  }
  return changed ? next : notices;
}

function sideEntrySupportedForProject(
  entry: ProjectSideSurfaceEntry,
  projectId: string
) {
  if (entry.kind === "projectCreation") {
    return false;
  }
  if (
    entry.kind === "databaseDeployment" ||
    entry.kind === "deploymentTaskTimeline" ||
    entry.kind === "dockerDeployment" ||
    entry.kind === "githubDeployment" ||
    entry.kind === "templateDeployment"
  ) {
    return entry.projectId === projectId;
  }
  return true;
}

/**
 * The Project Canvas Workbench: three identifiers in, three semantic groups
 * out. It privately instantiates Project Runtime observation and Canvas Layout
 * persistence, then orchestrates Project Surfaces, canvas selection and route
 * sync, Settings Launch Context, leave guards, the Deployment Task Dock and
 * Timeline, Resource Actions, and viewport directives on top of them.
 */
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
  const [
    dismissedDeploymentTaskUpdatedAtById,
    setDismissedDeploymentTaskUpdatedAtById,
  ] = useState<ReadonlyMap<string, string>>(() =>
    readBrowserDeploymentTaskDockDismissals({ namespace, projectId })
  );
  const deploymentTaskDockDismissalsKey = useMemo(
    () => deploymentTaskDockDismissalsStorageKey({ namespace, projectId }),
    [namespace, projectId]
  );
  const previousDeploymentTaskStatusByIdRef = useRef<
    ReadonlyMap<string, DeploymentTaskProjection["status"]>
  >(new Map());
  const [
    completedNoticeExpiresAtByTaskId,
    setCompletedNoticeExpiresAtByTaskId,
  ] = useState<ReadonlyMap<string, number>>(() => new Map());
  const projectCanvasLayout = useProjectCanvasLayout({
    enabled: kubeconfig.trim() !== "",
    kubeconfig,
    namespace,
    projectId,
  });

  const canvasCoveredRef = useRef(false);
  const isCanvasCovered = useCallback(() => canvasCoveredRef.current, []);
  const {
    apEnvironmentDbReferenceSources,
    canvasState,
    deploymentTaskProjections,
    frameState,
    isEmptyGraphLoading,
    isLoading: resourceSnapshotLoading,
    layoutIntent,
    refresh,
    revalidate,
    runtimeStore,
  } = useProjectCanvasResourceSnapshot({
    canvasLayout: projectCanvasLayout.layout,
    canvasLayoutReady: projectCanvasLayout.layoutReady,
    isCanvasCovered,
    kubeconfig,
    namespace,
    uid: projectId,
  });

  useEffect(() => {
    if (resourceSnapshotLoading || layoutIntent == null) {
      return;
    }
    if (layoutIntent.kind === "transaction") {
      projectCanvasLayout
        .saveLayoutTransaction({
          commands: layoutIntent.commands,
          expectedVersion: layoutIntent.expectedVersion,
          nodes: layoutIntent.nodes,
        })
        .catch(() => undefined);
      return;
    }
    projectCanvasLayout
      .saveFirstPlacementNodes(layoutIntent.nodes)
      .catch(() => undefined);
  }, [
    layoutIntent,
    projectCanvasLayout.saveFirstPlacementNodes,
    projectCanvasLayout.saveLayoutTransaction,
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

  useEffect(() => {
    setPendingApDbReferences([]);
    setDismissedDeploymentTaskUpdatedAtById(
      readBrowserDeploymentTaskDockDismissals({ namespace, projectId })
    );
    setCompletedNoticeExpiresAtByTaskId(new Map());
    previousDeploymentTaskStatusByIdRef.current = new Map();
  }, [namespace, projectId]);

  useEffect(() => {
    const previousStatusById = previousDeploymentTaskStatusByIdRef.current;
    const nextStatusById = new Map<
      string,
      DeploymentTaskProjection["status"]
    >();
    const completedNoticeTaskIds: string[] = [];
    for (const task of deploymentTaskProjections) {
      nextStatusById.set(task.id, task.status);
      if (
        (task.status === "completed" || task.status === "cancelled") &&
        deploymentTaskCanStartCompletionNotice(previousStatusById.get(task.id))
      ) {
        completedNoticeTaskIds.push(task.id);
      }
    }
    previousDeploymentTaskStatusByIdRef.current = nextStatusById;
    if (completedNoticeTaskIds.length === 0 || !currentPageVisible()) {
      return;
    }

    const expiresAt = Date.now() + DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_MS;
    setCompletedNoticeExpiresAtByTaskId((current) => {
      const next = new Map(current);
      for (const taskId of completedNoticeTaskIds) {
        next.set(taskId, expiresAt);
      }
      return next;
    });
  }, [deploymentTaskProjections]);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      completedNoticeExpiresAtByTaskId.size === 0
    ) {
      return;
    }

    const now = Date.now();
    const pruned = pruneExpiredCompletionNotices(
      completedNoticeExpiresAtByTaskId,
      now
    );
    if (pruned !== completedNoticeExpiresAtByTaskId) {
      setCompletedNoticeExpiresAtByTaskId(pruned);
      return;
    }

    let nextDelay: number | undefined;
    for (const expiresAt of completedNoticeExpiresAtByTaskId.values()) {
      const delay = Math.max(0, expiresAt - now);
      nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
    }
    if (nextDelay === undefined) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCompletedNoticeExpiresAtByTaskId((current) =>
        pruneExpiredCompletionNotices(current, Date.now())
      );
    }, nextDelay + 25);
    return () => {
      window.clearTimeout(timer);
    };
  }, [completedNoticeExpiresAtByTaskId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== deploymentTaskDockDismissalsKey) {
        return;
      }
      setDismissedDeploymentTaskUpdatedAtById(
        readBrowserDeploymentTaskDockDismissals({ namespace, projectId })
      );
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [deploymentTaskDockDismissalsKey, namespace, projectId]);

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

  const saveAutoLayoutNodes = useCallback(
    (nodes: CanvasLayoutNode[]) => {
      projectCanvasLayout.saveLayoutNodes(nodes).catch(() => undefined);
    },
    [projectCanvasLayout.saveLayoutNodes]
  );

  const onNodePositionChange = useStableCallback(
    (
      node: Parameters<typeof projectCanvasLayout.scheduleNodeLayoutSave>[0]
    ) => {
      if (isDeploymentPlaceholderNode(node)) {
        const placementNode =
          deploymentProjectionPlacementNodeFromUserDrag(node);
        if (placementNode !== undefined) {
          projectCanvasLayout
            .saveLayoutNodes([placementNode])
            .catch(() => undefined);
        }
        return;
      }
      projectCanvasLayout.scheduleNodeLayoutSave(node, { source: "user" });
    }
  );

  const rawNodes = canvasState.nodes;
  const routingDomain = useMemo(
    () => routingDomainFromKubeconfig(kubeconfig),
    [kubeconfig]
  );
  const {
    registerSettingsLeaveGuard,
    requestSettingsLeave,
    settingsLeaveGuardDialog,
  } = useSettingsLeaveGuardController();

  const canvasSelectionExists = useCallback(
    (selection: ProjectCanvasSelection) => {
      if (selection.kind === "edge") {
        return (
          canvasEdges.length === 0 ||
          canvasEdges.some((edge) => edge.id === selection.edgeId)
        );
      }
      return projectSelectionTargetExists(rawNodes, selection);
    },
    [canvasEdges, rawNodes]
  );

  const targetExists = useCallback(
    (target: Parameters<typeof projectTargetExistsOnCanvas>[1]) =>
      projectTargetExistsOnCanvas(rawNodes, target),
    [rawNodes]
  );

  const isSideEntrySupported = useCallback(
    (entry: ProjectSideSurfaceEntry) =>
      sideEntrySupportedForProject(entry, projectId),
    [projectId]
  );

  const workbenchRoute = useProjectWorkbenchRouteState({
    canvasSelectionExists,
    isSideEntrySupported,
    requestSidePaneLeave: requestSettingsLeave,
    selectionReady: !isEmptyGraphLoading,
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
    projectId,
    shouldOpenTask: shouldAutoOpenDeploymentTaskTimeline,
  });

  const resourceActions = useProjectResourceActions({
    kubeconfig,
    readOnly: false,
    refreshWorkloadLists: refresh,
    routingDomain,
  });

  const { bringNodeToFrontById, frontCanvasNode, stackOrderedNodes } =
    useProjectCanvasStackOrder({
      nodes: rawNodes,
      onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
      readOnly: false,
    });

  const { requestApDelete, requestDbDelete, resourceDeleteDialog } =
    useResourceDeleteDialogs({
      deleteApWorkload: resourceActions.apLifecycle.deleteWorkload,
      deleteDbWorkload: resourceActions.dbLifecycle.deleteWorkload,
      onResourceLayoutDelete: deleteResourceLayoutRefs,
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
  const flowStore = useMemo(() => createProjectCanvasFlowStore(), []);
  const getNodes = useStableCallback(
    (): readonly Node[] => flowStore.getSnapshot().nodes
  );
  useLayoutEffect(() => {
    flowStore.reconcile({ edges: canvasEdges, nodes });
  }, [canvasEdges, flowStore, nodes]);

  const autoLayoutCanvas = useStableCallback(() => {
    const snapshot = flowStore.getSnapshot();
    if (snapshot.nodes.length === 0) {
      return;
    }
    const relationships = runtimeStore.selectRelationshipIndexes();
    const { layoutNodes, positionChanges } = autoLayoutCanvasNodes({
      connections: [...relationships.publicAccessToAp, ...relationships.apToDb],
      nodes: snapshot.nodes,
    });
    if (positionChanges.length > 0) {
      flowStore.applyNodeChanges(positionChanges);
    }
    if (layoutNodes.length > 0) {
      saveAutoLayoutNodes(layoutNodes);
    }
  });

  const { apSettingsSessionEventsForAp } = useApSettingsSessionEvents({
    onPendingApDbReferencesStart: beginPendingApDbReferences,
  });

  const commitNodeLayout = useStableCallback((node: Node) => {
    flowStore.applyNodeChanges([{ id: node.id, item: node, type: "replace" }]);
    projectCanvasLayout.scheduleNodeLayoutSave(node);
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
      commitNodeLayout,
      copyDatabaseConnection,
      executeCommandPlan,
      getNodes,
      projectId,
      readOnly: false,
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
      commitNodeLayout,
      copyDatabaseConnection,
      executeCommandPlan,
      getNodes,
      projectId,
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
        ? (canvasEdges.find((edge) => edge.id === selected.edgeId) ?? null)
        : null,
    [canvasEdges, selected]
  );
  const activeSettingsEntry =
    surfaceState.side?.kind === "settings" ? surfaceState.side : null;
  const settingsReadModelHints = useMemo<SettingsReadModelHints>(
    () => ({
      ap: {
        dbDsnReferenceSources: apEnvironmentDbReferenceSources,
      },
    }),
    [apEnvironmentDbReferenceSources]
  );
  const settingsSessionEvents = useMemo<
    SettingsSessionEvents | undefined
  >(() => {
    const target = activeSettingsEntry?.target;
    if (target?.kind !== "AP") {
      return undefined;
    }
    return {
      ap: apSettingsSessionEventsForAp({
        name: target.name,
        namespace: target.namespace,
      }),
    };
  }, [activeSettingsEntry, apSettingsSessionEventsForAp]);
  const activeSettingsLaunchContext =
    activeSettingsEntry == null
      ? undefined
      : settingsLaunchContextStore.get({
          entry: activeSettingsEntry,
          slot: "side",
        });
  const settingsPresentation = useMemo(
    () => ({
      ...(activeSettingsLaunchContext === undefined
        ? {}
        : { launchContext: activeSettingsLaunchContext }),
      readModelHints: settingsReadModelHints,
      ...(settingsSessionEvents === undefined
        ? {}
        : { sessionEvents: settingsSessionEvents }),
    }),
    [activeSettingsLaunchContext, settingsReadModelHints, settingsSessionEvents]
  );
  const sideSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasSideRenderModel({
        nodes,
        runtimeStore,
        settings: settingsPresentation,
        surfaceState: {
          main: surfaceState.main,
          side: surfaceState.side,
        },
      }),
    [
      nodes,
      runtimeStore,
      settingsPresentation,
      surfaceState.main,
      surfaceState.side,
    ]
  );
  const mainSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasMainRenderModel({
        entry: surfaceState.main,
        nodes,
        runtimeStore,
      }),
    [nodes, runtimeStore, surfaceState.main]
  );
  const drawerSurfaceRenderModel = useMemo(
    () =>
      createProjectCanvasDrawerRenderModel({
        entry: surfaceState.drawer,
        nodes,
        runtimeStore,
      }),
    [nodes, runtimeStore, surfaceState.drawer]
  );
  const surfaceRenderModel = useMemo(
    () => ({
      drawer: drawerSurfaceRenderModel,
      main: mainSurfaceRenderModel,
      side: sideSurfaceRenderModel,
    }),
    [drawerSurfaceRenderModel, mainSurfaceRenderModel, sideSurfaceRenderModel]
  );
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

  const {
    clearRestoredDbServiceViewportFocus,
    onDbServiceRestoreAccepted,
    restoredDbServiceViewportFocusNodeId,
  } = useDbServiceRestoreFocus({
    focusCanvasSelection,
    mainSurface: surfaceState.main,
    nodes,
    refreshWorkloadLists: refresh,
  });

  const activeDeploymentTaskTimelineTaskId = useMemo(() => {
    const side = surfaceRenderModel.side;
    return side?.kind === "global" &&
      side.entry.kind === "deploymentTaskTimeline"
      ? side.entry.taskId
      : null;
  }, [surfaceRenderModel.side]);
  const sideViewportFocus = useMemo(() => {
    if (activeDeploymentTaskTimelineTaskId == null) {
      return null;
    }
    return {
      key: `deployment-task:${activeDeploymentTaskTimelineTaskId}:${sideViewportFocusRequestKey}`,
      nodeIds: deploymentTaskViewportFocusNodeIds({
        nodes,
        taskId: activeDeploymentTaskTimelineTaskId,
        tasks: deploymentTaskProjections,
      }),
    };
  }, [
    activeDeploymentTaskTimelineTaskId,
    deploymentTaskProjections,
    nodes,
    sideViewportFocusRequestKey,
  ]);
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
      sideViewportFocus !== null ||
      restoredDbServiceViewportFocusNodeId !== null,
    [
      restoredDbServiceViewportFocusNodeId,
      sideViewportFocus,
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
    readOnly: false,
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

  const closeResourcePane = closeSideSurface;
  const closeResourceLogsSurface = closeMainSurface;
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
        onNodePositionChange,
        projectId,
        projectCanvasConnectionLine:
          connectionGesture.projectCanvasConnectionLine,
        readOnly: false,
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
      onNodePositionChange,
      projectId,
      viewportDirectives,
    ]
  );

  const completedNoticeTaskIds = useMemo(() => {
    const now = Date.now();
    const taskIds = new Set<string>();
    for (const [taskId, expiresAt] of completedNoticeExpiresAtByTaskId) {
      if (expiresAt > now) {
        taskIds.add(taskId);
      }
    }
    return taskIds;
  }, [completedNoticeExpiresAtByTaskId]);
  const deploymentTaskDock = useMemo(
    () =>
      selectDeploymentTaskDock({
        activeTaskId: activeDeploymentTaskTimelineTaskId,
        completedNoticeTaskIds,
        dismissedTaskUpdatedAtById: dismissedDeploymentTaskUpdatedAtById,
        tasks: deploymentTaskProjections,
      }),
    [
      activeDeploymentTaskTimelineTaskId,
      completedNoticeTaskIds,
      deploymentTaskProjections,
      dismissedDeploymentTaskUpdatedAtById,
    ]
  );
  const openDeploymentTaskDockTask = useCallback(
    (taskId: string) => {
      openSideSurface({
        kind: "deploymentTaskTimeline",
        projectId,
        taskId,
      });
    },
    [openSideSurface, projectId]
  );
  const dismissDeploymentTaskDockTask = useCallback(
    (taskId: string) => {
      const task = deploymentTaskProjections.find((item) => item.id === taskId);
      if (task == null) {
        return;
      }
      setDismissedDeploymentTaskUpdatedAtById((current) => {
        if (current.get(taskId) === task.updatedAt) {
          return current;
        }
        const next = new Map(current);
        next.set(taskId, task.updatedAt);
        writeBrowserDeploymentTaskDockDismissals({
          dismissedTaskUpdatedAtById: next,
          namespace,
          projectId,
        });
        return next;
      });
      setCompletedNoticeExpiresAtByTaskId((current) => {
        if (!current.has(taskId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(taskId);
        return next;
      });
      // The active chip is the open timeline pane's handle, so the dismissal
      // alone cannot remove it; close the pane so the dismissal takes visible
      // effect (CONTEXT.md: Deployment Task Dock Dismissal).
      if (taskId === activeDeploymentTaskTimelineTaskId) {
        closeResourcePane();
      }
    },
    [
      activeDeploymentTaskTimelineTaskId,
      closeResourcePane,
      deploymentTaskProjections,
      namespace,
      projectId,
    ]
  );

  const canvasCovered =
    surfaceRenderModel.main != null &&
    surfaceRenderModel.main.kind !== "pendingTarget";
  canvasCoveredRef.current = canvasCovered;
  const previousCanvasCoveredRef = useRef(canvasCovered);
  useEffect(() => {
    const wasCovered = previousCanvasCoveredRef.current;
    previousCanvasCoveredRef.current = canvasCovered;
    if (wasCovered && !canvasCovered) {
      revalidate().catch(() => undefined);
    }
  }, [canvasCovered, revalidate]);

  const openingKey = `${namespace}:${projectId}`;
  useLayoutEffect(() => {
    viewportDirectives.setOpeningFitKey(openingKey);
    viewportDirectives.setFollow({
      isFollowTarget: isCanvasNodeGeneratedPosition,
      key: openingKey,
    });
  }, [openingKey, viewportDirectives]);

  const surfaceActions = useMemo<ProjectCanvasSurfaceHostActions>(
    () => ({
      closeDrawerSurface,
      closeMainSurface,
      closeResourceLogsSurface,
      closeResourcePane,
      consumeSettingsLaunchContext,
      onDbServiceRestoreAccepted,
      registerSettingsLeaveGuard,
      repairSide,
    }),
    [
      closeDrawerSurface,
      closeMainSurface,
      closeResourceLogsSurface,
      closeResourcePane,
      consumeSettingsLaunchContext,
      onDbServiceRestoreAccepted,
      registerSettingsLeaveGuard,
      repairSide,
    ]
  );

  const surfaceDialogs = useMemo(
    () => [
      createElement(
        Fragment,
        { key: "settings-leave-guard" },
        settingsLeaveGuardDialog
      ),
      createElement(Fragment, { key: "resource-delete" }, resourceDeleteDialog),
      createElement(
        Fragment,
        { key: "resource-lifecycle" },
        resourceLifecycleDialogs
      ),
    ],
    [resourceDeleteDialog, resourceLifecycleDialogs, settingsLeaveGuardDialog]
  );

  const openSurfaceIntent = useCallback(
    (
      intent: ProjectSurfaceIntent,
      launchSource: SettingsLaunchSource = "toolbar"
    ) => {
      if (intent.slot === "drawer") {
        openDrawerSurface(intent.entry);
        return;
      }
      if (intent.slot === "main") {
        openMainSurface(intent.entry);
        return;
      }
      openSideSurface(intent.entry, undefined, launchSource);
    },
    [openDrawerSurface, openMainSurface, openSideSurface]
  );

  return {
    actions: {
      dismissDeploymentTaskDockTask,
      openSurfaceIntent,
      openDeploymentTaskDockTask,
    },
    canvas: {
      autoLayout: autoLayoutCanvas,
      covered: canvasCovered,
      deploymentTaskDock,
      frameState,
      interactionStore,
      lifecycleActivityStore,
      meta,
      nodeCommands,
      runtimeStore,
      viewportDirectives,
    },
    surfaces: {
      actions: surfaceActions,
      dialogs: surfaceDialogs,
      model: surfaceRenderModel,
      refreshWorkloadLists: refresh,
    },
  };
}
