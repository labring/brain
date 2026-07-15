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
  useSyncExternalStore,
} from "react";
import {
  acknowledgePendingDeployTaskCreatedEvent,
  DEPLOY_TASK_CREATED_EVENT,
  type DeployTaskCreatedEvent,
  pendingDeployTaskCreatedEvents,
} from "@/features/deploy/task/browser-events";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type {
  ProjectSideSurfaceEntry,
  ProjectSurfaceIntent,
} from "@/features/panes/surface-state";
import { useProjectWorkbenchRouteState } from "@/features/panes/use-project-workbench-route-state";
import { useProjectCanvasResourceActions } from "@/features/project-canvas/actions/use-project-canvas-resource-actions";
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/features/project-canvas/flow/pending-connections";
import { autoLayoutCanvasNodes } from "@/features/project-canvas/layout/auto-layout";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  canvasNodeResourceStackKey,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "@/features/project-canvas/layout/node-stack-order";
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
import { selectDeploymentTaskDock } from "@/features/project-canvas/workbench/deployment-task-timeline-reentry";
import type { ProjectCanvasNodeCommands } from "@/features/project-canvas/workbench/node-commands-react";
import { executeUnguardedProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/project-canvas-command-executor";
import { createProjectCanvasFlowStore } from "@/features/project-canvas/workbench/project-canvas-flow-store";
import type { ProjectCanvasSurfaceHostActions } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useApSettingsSessionEvents } from "@/features/project-canvas/workbench/use-ap-settings-session-events";
import { useDbServiceRestoreFocus } from "@/features/project-canvas/workbench/use-db-service-restore-focus";
import { useProjectCanvasConnectionGesture } from "@/features/project-canvas/workbench/use-project-canvas-connection-gesture";
import { createProjectCanvasViewportDirectiveStore } from "@/features/project-canvas/workbench/viewport-directive-store";
import {
  realWorkbenchClock,
  type WorkbenchClock,
} from "@/features/project-canvas/workbench/workbench-clock";
import {
  createWorkbenchOrchestrationStore,
  type WorkbenchOrchestrationEffect,
  type WorkbenchOrchestrationEvent,
  type WorkbenchOrchestrationStore,
} from "@/features/project-canvas/workbench/workbench-orchestration";
import { useSettingsLeaveGuardController } from "@/features/resource-settings/settings-leave-guard-controller";
import type {
  SettingsReadModelHints,
  SettingsSessionEvents,
} from "@/features/resource-settings/settings-types";

function currentPageVisible(): boolean {
  return isEffectivelyVisible();
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
 * The Project Canvas Workbench: three identifiers in (plus an optional clock
 * seam), three semantic groups out. It privately instantiates Project Runtime
 * observation and Canvas Layout persistence, then orchestrates Project
 * Surfaces, canvas selection and route sync, Settings Launch Context, leave
 * guards, the Deployment Task Dock and Timeline, Resource Actions, and
 * viewport directives on top of them. Orchestration decisions live in the
 * workbench-orchestration core as pure transitions; this hook is the effect
 * boundary that reads facts, submits events, and executes effect plans.
 */
export function useProjectCanvasModule({
  clock = realWorkbenchClock,
  kubeconfig,
  namespace,
  projectId,
}: {
  /** Defaults to real timers; tests pass a manual clock to drive notice expiry. */
  clock?: WorkbenchClock;
  kubeconfig: string;
  namespace: string;
  projectId: string;
}) {
  const [pendingApDbReferences, setPendingApDbReferences] = useState<
    PendingApDbCanvasReference[]
  >([]);
  const orchestrationRef = useRef<WorkbenchOrchestrationStore | null>(null);
  orchestrationRef.current ??= createWorkbenchOrchestrationStore({
    dismissedTaskUpdatedAtById: readBrowserDeploymentTaskDockDismissals({
      namespace,
      projectId,
    }),
  });
  const orchestration = orchestrationRef.current;
  const orchestrationState = useSyncExternalStore(
    orchestration.subscribe,
    orchestration.getSnapshot,
    orchestration.getSnapshot
  );
  const noticeExpiryCancelRef = useRef<(() => void) | null>(null);
  const runOrchestrationEffects = useStableCallback(
    (effects: readonly WorkbenchOrchestrationEffect[]) => {
      for (const effect of effects) {
        switch (effect.kind) {
          case "acknowledgeDeployTaskCreated": {
            acknowledgePendingDeployTaskCreatedEvent(effect.taskId);
            break;
          }
          case "closeSideSurface": {
            closeSideSurface();
            break;
          }
          case "openDeploymentTaskTimelineRoute": {
            openSideRoute(effect.entry, effect.canvasSelection, () => {
              submitOrchestrationEvent({
                kind: "deploymentTaskTimelineRouteCommitted",
              });
            });
            break;
          }
          case "persistCanvasNodeLayout": {
            projectCanvasLayout.scheduleNodeLayoutSave(effect.node);
            break;
          }
          case "persistDeploymentTaskDockDismissals": {
            writeBrowserDeploymentTaskDockDismissals({
              dismissedTaskUpdatedAtById: effect.dismissedTaskUpdatedAtById,
              namespace,
              projectId,
            });
            break;
          }
          case "rescheduleNoticeExpiry": {
            noticeExpiryCancelRef.current?.();
            noticeExpiryCancelRef.current =
              effect.delayMs == null
                ? null
                : clock.schedule(() => {
                    noticeExpiryCancelRef.current = null;
                    submitOrchestrationEvent({
                      kind: "noticeExpiryDue",
                      now: clock.now(),
                    });
                  }, effect.delayMs);
            break;
          }
          case "revalidateResourceSnapshot": {
            revalidate().catch(() => undefined);
            break;
          }
          default: {
            effect satisfies never;
          }
        }
      }
    }
  );
  const submitOrchestrationEvent = useStableCallback(
    (event: WorkbenchOrchestrationEvent) => {
      runOrchestrationEffects(orchestration.dispatch(event));
    }
  );
  useEffect(
    () => () => {
      noticeExpiryCancelRef.current?.();
      noticeExpiryCancelRef.current = null;
    },
    []
  );
  const deploymentTaskDockDismissalsKey = useMemo(
    () => deploymentTaskDockDismissalsStorageKey({ namespace, projectId }),
    [namespace, projectId]
  );
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
    submitOrchestrationEvent({
      dismissedTaskUpdatedAtById: readBrowserDeploymentTaskDockDismissals({
        namespace,
        projectId,
      }),
      kind: "workbenchIdentityChanged",
    });
  }, [namespace, projectId, submitOrchestrationEvent]);

  useEffect(() => {
    submitOrchestrationEvent({
      kind: "deploymentTasksArrived",
      now: clock.now(),
      pageVisible: currentPageVisible(),
      tasks: deploymentTaskProjections,
    });
  }, [clock, deploymentTaskProjections, submitOrchestrationEvent]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== deploymentTaskDockDismissalsKey) {
        return;
      }
      submitOrchestrationEvent({
        dismissedTaskUpdatedAtById: readBrowserDeploymentTaskDockDismissals({
          namespace,
          projectId,
        }),
        kind: "deploymentTaskDockDismissalsReloaded",
      });
    };

    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [
    deploymentTaskDockDismissalsKey,
    namespace,
    projectId,
    submitOrchestrationEvent,
  ]);

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
        submitOrchestrationEvent({
          canvasSelection,
          entry,
          kind: "deploymentTaskTimelineOpenRequested",
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
    [
      openSideRoute,
      settingsLaunchContextStore,
      submitOrchestrationEvent,
      writeSettingsLaunchContext,
    ]
  );

  useEffect(() => {
    const submitDeployTaskCreated = (
      detail: DeployTaskCreatedEvent["detail"]
    ) => {
      submitOrchestrationEvent({
        detail,
        kind: "deployTaskCreatedEventReceived",
        workbenchProjectId: projectId,
      });
    };
    const onDeployTaskCreated = (event: Event) => {
      submitDeployTaskCreated((event as DeployTaskCreatedEvent).detail);
    };

    for (const pending of pendingDeployTaskCreatedEvents()) {
      submitDeployTaskCreated(pending);
    }
    window.addEventListener(DEPLOY_TASK_CREATED_EVENT, onDeployTaskCreated);
    return () => {
      window.removeEventListener(
        DEPLOY_TASK_CREATED_EVENT,
        onDeployTaskCreated
      );
    };
  }, [projectId, submitOrchestrationEvent]);

  const resourceActions = useProjectCanvasResourceActions({
    kubeconfig,
    onResourceLayoutDelete: deleteResourceLayoutRefs,
    refreshWorkloadLists: refresh,
  });

  const localCanvasStackOrderByRef =
    orchestrationState.localCanvasStackOrderByRef;
  const stackOrderedNodes = useMemo(() => {
    const overridden = rawNodes.map((node) => {
      const key = canvasNodeResourceStackKey(node);
      const stackOrder =
        key === undefined ? undefined : localCanvasStackOrderByRef.get(key);
      return stackOrder === undefined
        ? node
        : nodeWithCanvasStackOrder(node, stackOrder);
    });
    return applyCanvasStackOrderToNodes(overridden);
  }, [localCanvasStackOrderByRef, rawNodes]);

  const frontCanvasNode = useStableCallback(
    (node: Node, options?: { persist?: boolean }) => {
      const sourceNodes = stackOrderedNodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, position: { ...node.position } }
          : candidate
      );
      const result = bringCanvasNodeToFrontInStackOrder(sourceNodes, node.id);
      const nextNode = result.node;
      if (!result.changed || nextNode === undefined) {
        return;
      }
      submitOrchestrationEvent({
        kind: "canvasNodeBroughtToFront",
        node: nextNode,
        persist: options?.persist !== false,
        stackKey: canvasNodeResourceStackKey(nextNode),
        stackOrder: canvasNodeStackOrder(nextNode),
      });
      return nextNode;
    }
  );

  const bringNodeToFrontById = useStableCallback((nodeId: string) => {
    const node = stackOrderedNodes.find((candidate) => candidate.id === nodeId);
    if (node !== undefined) {
      frontCanvasNode(node);
    }
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

  const resourceActionCommands = resourceActions.commands;
  const nodeCommands = useMemo<ProjectCanvasNodeCommands>(
    () => ({
      commitNodeLayout,
      ...resourceActionCommands,
      executeCommandPlan,
      getNodes,
      projectId,
      readOnly: false,
    }),
    [
      commitNodeLayout,
      executeCommandPlan,
      getNodes,
      projectId,
      resourceActionCommands,
    ]
  );

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
  const sideViewportFocusRequestSeq =
    orchestrationState.sideViewportFocusRequestSeq;
  const sideViewportFocus = useMemo(() => {
    if (activeDeploymentTaskTimelineTaskId == null) {
      return null;
    }
    return {
      key: `deployment-task:${activeDeploymentTaskTimelineTaskId}:${sideViewportFocusRequestSeq}`,
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
    sideViewportFocusRequestSeq,
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
      submitOrchestrationEvent({
        kind: "deploymentTaskTimelineManuallyClosed",
        taskId: side.taskId,
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
    submitOrchestrationEvent,
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

  const completedNoticeExpiresAtByTaskId =
    orchestrationState.completedNoticeExpiresAtByTaskId;
  const completedNoticeTaskIds = useMemo(() => {
    const now = clock.now();
    const taskIds = new Set<string>();
    for (const [taskId, expiresAt] of completedNoticeExpiresAtByTaskId) {
      if (expiresAt > now) {
        taskIds.add(taskId);
      }
    }
    return taskIds;
  }, [clock, completedNoticeExpiresAtByTaskId]);
  const dismissedDeploymentTaskUpdatedAtById =
    orchestrationState.dismissedDeploymentTaskUpdatedAtById;
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
      submitOrchestrationEvent({
        activeTimelineTaskId: activeDeploymentTaskTimelineTaskId,
        kind: "deploymentTaskDismissRequested",
        now: clock.now(),
        task,
      });
    },
    [
      activeDeploymentTaskTimelineTaskId,
      clock,
      deploymentTaskProjections,
      submitOrchestrationEvent,
    ]
  );

  const canvasCovered =
    surfaceRenderModel.main != null &&
    surfaceRenderModel.main.kind !== "pendingTarget";
  canvasCoveredRef.current = canvasCovered;
  useEffect(() => {
    submitOrchestrationEvent({
      covered: canvasCovered,
      kind: "canvasCoveredChanged",
    });
  }, [canvasCovered, submitOrchestrationEvent]);

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

  const resourceActionDialogs = resourceActions.dialogs;
  const surfaceDialogs = useMemo(
    () => [
      createElement(
        Fragment,
        { key: "settings-leave-guard" },
        settingsLeaveGuardDialog
      ),
      ...resourceActionDialogs,
    ],
    [resourceActionDialogs, settingsLeaveGuardDialog]
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
      lifecycleActivityStore: resourceActions.lifecycleActivityStore,
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
