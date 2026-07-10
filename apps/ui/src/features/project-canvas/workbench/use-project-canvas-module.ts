"use client";

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
import {
  addPendingApDbCanvasReferences,
  type PendingApDbCanvasReference,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "@/features/project-canvas/flow/pending-connections";
import { isCanvasNodeGeneratedPosition } from "@/features/project-canvas/layout/placement";
import { resourcePlacementOwner } from "@/features/project-canvas/layout/placement-owner";
import type {
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
} from "@/features/project-canvas/layout/types";
import { useProjectCanvasLayout } from "@/features/project-canvas/layout/use-project-canvas-layout";
import { isDeploymentPlaceholderNode } from "@/features/project-canvas/snapshot/deployment-placeholder-nodes";
import { deploymentProjectionPlacementNodesFromPlaceholderNode } from "@/features/project-canvas/snapshot/deployment-placement-commands";
import { deploymentTaskViewportFocusNodeIds } from "@/features/project-canvas/snapshot/deployment-viewport-focus";
import { useProjectCanvasResourceSnapshot } from "@/features/project-canvas/snapshot/use-project-canvas-resource-snapshot";
import {
  deploymentTaskDockDismissalsStorageKey,
  readBrowserDeploymentTaskDockDismissals,
  writeBrowserDeploymentTaskDockDismissals,
} from "@/features/project-canvas/workbench/deployment-task-dock-dismissals";
import {
  DEPLOYMENT_TASK_DOCK_COMPLETION_NOTICE_MS,
  selectDeploymentTaskDock,
} from "@/features/project-canvas/workbench/deployment-task-timeline-reentry";
import type { ProjectCanvasSurfaceHostActions } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import {
  type ProjectCanvasSideViewportFocusResolver,
  useProjectCanvas,
} from "@/features/project-canvas/workbench/use-project-canvas";
import type { SettingsLaunchSource } from "@/features/project-runtime/settings-launch-context";
import type { ProjectSurfaceIntent } from "@/features/project-surfaces/surface-state";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import { useStableCallback } from "@/lib/use-stable-callback";

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
  return typeof document === "undefined" ? true : !document.hidden;
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
    }
  );
  const sideViewportFocus = useCallback<ProjectCanvasSideViewportFocusResolver>(
    ({ nodes, requestKey, side }) => {
      const taskId =
        side?.kind === "global" && side.entry.kind === "deploymentTaskTimeline"
          ? side.entry.taskId
          : null;
      if (taskId == null) {
        return null;
      }
      return {
        active: true,
        key: `deployment-task:${taskId}:${requestKey}`,
        nodeIds: deploymentTaskViewportFocusNodeIds({
          nodes,
          taskId,
          tasks: deploymentTaskProjections,
        }),
      };
    },
    [deploymentTaskProjections]
  );

  const workbench = useProjectCanvas(canvasState.nodes, {
    apEnvironmentDbReferenceSources,
    edges: canvasEdges,
    kubeconfig,
    namespace,
    onCanvasAutoLayout: saveAutoLayoutNodes,
    onNodeExpansionChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onNodePositionChange,
    onNodeStackOrderChange: projectCanvasLayout.scheduleNodeLayoutSave,
    onPendingApDbReferencesStart: beginPendingApDbReferences,
    onResourceLayoutDelete: deleteResourceLayoutRefs,
    projectId,
    refreshWorkloadLists: refresh,
    runtimeStore,
    selectionReady: !isEmptyGraphLoading,
    sideViewportFocus,
  });
  const activeDeploymentTaskTimelineTaskId = useMemo(() => {
    const side = workbench.surfaceRenderModel.side;
    return side?.kind === "global" &&
      side.entry.kind === "deploymentTaskTimeline"
      ? side.entry.taskId
      : null;
  }, [workbench.surfaceRenderModel.side]);
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
      workbench.openSideSurface({
        kind: "deploymentTaskTimeline",
        projectId,
        taskId,
      });
    },
    [projectId, workbench.openSideSurface]
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
        workbench.closeResourcePane();
      }
    },
    [
      activeDeploymentTaskTimelineTaskId,
      deploymentTaskProjections,
      namespace,
      projectId,
      workbench.closeResourcePane,
    ]
  );

  const mainRenderModel = workbench.surfaceRenderModel.main;
  const canvasCovered =
    mainRenderModel != null && mainRenderModel.kind !== "pendingTarget";
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
  const viewportDirectives = workbench.viewportDirectives;
  useLayoutEffect(() => {
    viewportDirectives.setOpeningFitKey(openingKey);
    viewportDirectives.setFollow({
      isFollowTarget: isCanvasNodeGeneratedPosition,
      key: openingKey,
    });
  }, [openingKey, viewportDirectives]);
  const meta = workbench.meta;

  const surfaceActions = useMemo<ProjectCanvasSurfaceHostActions>(
    () => ({
      closeDrawerSurface: workbench.closeDrawerSurface,
      closeMainSurface: workbench.closeMainSurface,
      closeResourceLogsSurface: workbench.closeResourceLogsSurface,
      closeResourcePane: workbench.closeResourcePane,
      consumeSettingsLaunchContext: workbench.consumeSettingsLaunchContext,
      onDbServiceRestoreAccepted: workbench.onDbServiceRestoreAccepted,
      registerSettingsLeaveGuard: workbench.registerSettingsLeaveGuard,
      repairSide: workbench.repairSide,
    }),
    [
      workbench.closeDrawerSurface,
      workbench.closeMainSurface,
      workbench.closeResourceLogsSurface,
      workbench.closeResourcePane,
      workbench.consumeSettingsLaunchContext,
      workbench.onDbServiceRestoreAccepted,
      workbench.registerSettingsLeaveGuard,
      workbench.repairSide,
    ]
  );

  const surfaceDialogs = useMemo(
    () => [
      createElement(
        Fragment,
        { key: "settings-leave-guard" },
        workbench.settingsLeaveGuardDialog
      ),
      createElement(
        Fragment,
        { key: "resource-delete" },
        workbench.resourceDeleteDialog
      ),
      createElement(
        Fragment,
        { key: "resource-stop" },
        workbench.resourceStopDialog
      ),
    ],
    [
      workbench.resourceDeleteDialog,
      workbench.resourceStopDialog,
      workbench.settingsLeaveGuardDialog,
    ]
  );

  const openSurfaceIntent = useCallback(
    (
      intent: ProjectSurfaceIntent,
      launchSource: SettingsLaunchSource = "toolbar"
    ) => {
      if (intent.slot === "drawer") {
        workbench.openDrawerSurface(intent.entry);
        return;
      }
      if (intent.slot === "main") {
        workbench.openMainSurface(intent.entry);
        return;
      }
      workbench.openSideSurface(intent.entry, undefined, launchSource);
    },
    [
      workbench.openDrawerSurface,
      workbench.openMainSurface,
      workbench.openSideSurface,
    ]
  );

  return {
    actions: {
      dismissDeploymentTaskDockTask,
      openSurfaceIntent,
      openDeploymentTaskDockTask,
    },
    canvas: {
      autoLayout: workbench.autoLayoutCanvas,
      covered: canvasCovered,
      deploymentTaskDock,
      frameState,
      interactionStore: workbench.interactionStore,
      lifecycleActivityStore: workbench.lifecycleActivityStore,
      meta,
      nodeCommands: workbench.nodeCommands,
      runtimeStore,
      viewportDirectives,
    },
    surfaces: {
      actions: surfaceActions,
      dialogs: surfaceDialogs,
      model: workbench.surfaceRenderModel,
      refreshWorkloadLists: refresh,
      settingsLaunchContext: workbench.settingsLaunchContext,
      settingsReadModelHints: workbench.settingsReadModelHints,
      settingsSessionEvents: workbench.settingsSessionEvents,
    },
  };
}
