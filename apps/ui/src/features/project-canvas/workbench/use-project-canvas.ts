"use client";

import {
  useApLifecycleOperations,
  useDbLifecycleOperations,
} from "@workspace/api/hooks";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type {
  CanvasMeta,
  CanvasReactFlowProps,
  CanvasSelectedNode,
} from "@workspace/ui/components/canvas/canvas.types";
import type { CanvasNodeConnectionSide } from "@workspace/ui/components/canvas-node/canvas-node";
import type { ContainerSettingsPaneAddDbDsnReferenceIntent } from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import type {
  DatabaseNodeCopyConnectionHandler,
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import type { Connection, Edge, Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  DATABASE_PANE,
  projectCanvasFlowNodeTypes,
  WORKLOAD_PANE,
} from "@/features/project-canvas/canvas-store";
import {
  canvasNodeGeometryFromNode,
  selectCanvasAnchorPair,
} from "@/features/project-canvas/flow/anchor-pair";
import {
  classifyProjectCanvasConnectionCommand,
  isProjectCanvasConnectionSupported,
} from "@/features/project-canvas/flow/connection-command";
import { createProjectCanvasConnectionLine } from "@/features/project-canvas/flow/connection-line";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import {
  connectionFromProjectCanvasConnectEndGesture,
  connectionHandleFromConnectStartParams,
  type ProjectCanvasConnectionHandle,
  projectCanvasInteractionProps,
} from "@/features/project-canvas/flow/interaction";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import { dbDsnReferenceSourcesFromDbsData } from "@/features/project-canvas/k8s/db-dsn-reference-sources";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  canvasNodeResourceStackKey,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "@/features/project-canvas/layout/node-stack-order";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { CanvasEntrySelectionRef } from "@/features/project-canvas/nodes/entry-node-selection";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasNodeLayoutState,
  CanvasNodeSettingsAccess,
} from "@/features/project-canvas/nodes/types";
import { useSettingsLeaveGuardController } from "@/features/project-canvas/panels/settings-leave-guard";
import {
  defaultProjectSideSurfaceForNode,
  drawerSurfaceForApTerminal,
  drawerSurfaceForDbConsole,
  findCanvasNodeForProjectTarget,
  mainSurfaceForDbAccess,
  mainSurfaceForResourceLogs,
  projectApTargetFromNode,
  projectCanvasSelectionFromNode,
  projectDbTargetFromNode,
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
  sideSurfaceForDatabasePane,
  sideSurfaceForWorkloadPane,
} from "@/features/project-canvas/surface/selection";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import { useProjectWorkbenchRouteState } from "@/features/project-route-state/use-project-workbench-route-state";
import {
  type ProjectDrawerSurfaceEntry,
  type ProjectMainSurfaceEntry,
  type ProjectSideSurfaceEntry,
  projectSideSurfaceVisible,
  projectSurfaceEntryTarget,
} from "@/features/project-surfaces/surface-state";
import { projectApTarget } from "@/features/project-surfaces/target-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

export interface UseProjectCanvasOptions {
  dbsData?: K8sGetResponse;
  edges?: Edge[];
  kubeconfig?: string;
  namespace?: string;
  onNodeExpansionChange?: (node: Node) => void;
  onNodePositionChange?: (node: Node) => void;
  onNodeStackOrderChange?: (node: Node) => void;
  onPendingApDbReferencesStart?: (
    references: readonly PendingApDbCanvasReference[]
  ) => (() => void) | undefined;
  projectUid?: string;
  readOnly?: boolean;
  /** Refetch workload list(s) after PATCH/POST/DELETE lifecycle calls. */
  refreshWorkloadLists?: () => Promise<unknown>;
  /** True when the resource lists have settled enough to clear stale URL selections. */
  selectionReady?: boolean;
}

interface PendingAddDbDsnReferenceIntent
  extends ContainerSettingsPaneAddDbDsnReferenceIntent {
  apNodeId: string;
}

interface ProjectCanvasConnectionOrigin {
  nodeId: string;
  side: CanvasNodeConnectionSide;
}

const CANVAS_NODE_CONNECTION_SIDES = new Set<string>([
  "bottom",
  "left",
  "right",
  "top",
]);

function connectionOriginFromHandle(
  handle: ProjectCanvasConnectionHandle | null
): ProjectCanvasConnectionOrigin | null {
  if (
    handle?.nodeId == null ||
    handle.id == null ||
    !CANVAS_NODE_CONNECTION_SIDES.has(handle.id)
  ) {
    return null;
  }

  return {
    nodeId: handle.nodeId,
    side: handle.id as CanvasNodeConnectionSide,
  };
}

function dbReferenceIntentDataForContainerNode({
  intent,
  nodeId,
  onConsumed,
}: {
  intent: PendingAddDbDsnReferenceIntent | null;
  nodeId: string;
  onConsumed: (id: string) => void;
}): Pick<
  CanvasContainerNodeData,
  "addDbDsnReferenceIntent" | "onAddDbDsnReferenceIntentConsumed"
> {
  if (intent?.apNodeId !== nodeId) {
    return {};
  }

  return {
    addDbDsnReferenceIntent: {
      dbName: intent.dbName,
      dbNamespace: intent.dbNamespace,
      id: intent.id,
    },
    onAddDbDsnReferenceIntentConsumed: onConsumed,
  };
}

function createPendingApDbReferenceMutationStartHandler({
  apName,
  apNamespace,
  onPendingApDbReferencesStart,
}: {
  apName: string;
  apNamespace: string;
  onPendingApDbReferencesStart:
    | UseProjectCanvasOptions["onPendingApDbReferencesStart"]
    | undefined;
}): CanvasContainerNodeData["onAddDbDsnReferenceMutationStart"] {
  if (
    onPendingApDbReferencesStart === undefined ||
    apName === "" ||
    apNamespace === ""
  ) {
    return undefined;
  }

  return (references) =>
    onPendingApDbReferencesStart(
      references.map((reference) => ({
        id: reference.id,
        source: {
          kind: "AP",
          name: apName,
          namespace: apNamespace,
        },
        target: {
          kind: "DB",
          name: reference.dbName,
          namespace: reference.dbNamespace,
        },
      }))
    );
}

function canvasNodeSettingsAccess({
  readOnly,
}: {
  readOnly: boolean;
}): CanvasNodeSettingsAccess | undefined {
  if (!readOnly) {
    return undefined;
  }
  return { readOnly: true };
}

function selectedEntryRefFromSurfaceState({
  selected,
  side,
}: {
  selected: ProjectCanvasSelection | null;
  side: ProjectSideSurfaceEntry | null;
}): CanvasEntrySelectionRef | null {
  if (side?.kind === "publicAddresses") {
    return {
      apName: side.target.apName,
      namespace: side.target.namespace,
    };
  }

  if (selected?.kind !== "publicAddresses") {
    return null;
  }

  return {
    apName: selected.target.apName,
    namespace: selected.target.namespace,
  };
}

function sideWorkloadPaneFromEntry(entry: ProjectSideSurfaceEntry | null) {
  switch (entry?.kind) {
    case "apEvents":
      return WORKLOAD_PANE.events;
    case "apHistory":
      return WORKLOAD_PANE.history;
    case "apMetrics":
      return WORKLOAD_PANE.metrics;
    case "apSettings":
      return WORKLOAD_PANE.settings;
    default:
      return null;
  }
}

function sideDatabasePaneFromEntry(entry: ProjectSideSurfaceEntry | null) {
  switch (entry?.kind) {
    case "dbMetrics":
      return DATABASE_PANE.metrics;
    case "dbSettings":
      return DATABASE_PANE.settings;
    default:
      return null;
  }
}

function sideEntryPaneFromEntry(entry: ProjectSideSurfaceEntry | null) {
  return entry?.kind === "publicAddresses" ? "settings" : null;
}

function mainWorkloadPaneFromEntry(entry: ProjectMainSurfaceEntry | null) {
  return entry?.kind === "resourceLogs" && entry.target.kind === "AP"
    ? WORKLOAD_PANE.logs
    : null;
}

function mainDatabasePaneFromEntry(entry: ProjectMainSurfaceEntry | null) {
  return entry?.kind === "resourceLogs" && entry.target.kind === "DB"
    ? DATABASE_PANE.logs
    : null;
}

function drawerWorkloadPaneFromEntry(entry: ProjectDrawerSurfaceEntry | null) {
  return entry?.kind === "apTerminal" ? WORKLOAD_PANE.terminal : null;
}

function drawerDatabasePaneFromEntry(entry: ProjectDrawerSurfaceEntry | null) {
  return entry?.kind === "dbConsole" ? DATABASE_PANE.console : null;
}

/**
 * Wires slot-based project surface query state, canvas selection, node toolbar actions,
 * AP lifecycle menu actions, and canvas `meta` for `<Canvas.Root />`.
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
  const addDbDsnReferenceIntentCounter = useRef(0);
  const connectHandledInGestureRef = useRef(false);
  const connectingFromHandleRef = useRef<ProjectCanvasConnectionHandle | null>(
    null
  );
  const snappedConnectionInGestureRef = useRef<Connection | null>(null);
  const [connectionOrigin, setConnectionOrigin] =
    useState<ProjectCanvasConnectionOrigin | null>(null);
  const [connectionGestureActive, setConnectionGestureActive] = useState(false);
  const [localStackOrderByRef, setLocalStackOrderByRef] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [pendingAddDbDsnReferenceIntent, setPendingAddDbDsnReferenceIntent] =
    useState<PendingAddDbDsnReferenceIntent | null>(null);
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
    (entry: ProjectSideSurfaceEntry) => {
      if (entry.kind === "projectCreation") {
        return false;
      }
      if (
        (entry.kind === "databaseDeployment" ||
          entry.kind === "dockerDeployment" ||
          entry.kind === "githubDeployment") &&
        options?.projectUid != null
      ) {
        return entry.projectUid === options.projectUid;
      }
      return true;
    },
    [options?.projectUid]
  );
  const workbenchRoute = useProjectWorkbenchRouteState({
    canvasSelectionExists,
    isSideEntrySupported,
    requestSidePaneLeave: requestSettingsLeave,
    selectionReady,
    targetExists,
  });
  const selected = workbenchRoute.canvasSelection;
  const side = workbenchRoute.side;
  const main = workbenchRoute.main;
  const drawer = workbenchRoute.drawer;
  const surfaceState = workbenchRoute.surfaces;
  const writeSelection = workbenchRoute.writeCanvasSelection;
  const openSideSurface = workbenchRoute.openSide;
  const openMainSurface = workbenchRoute.openMain;
  const openDrawerSurface = workbenchRoute.openDrawer;
  const closeSideRoute = workbenchRoute.closeSide;
  const closeMainRoute = workbenchRoute.closeMain;
  const closeDrawerRoute = workbenchRoute.closeDrawer;
  const clearCanvasFocus = workbenchRoute.clearCanvasFocus;
  const focusCanvasSelection = workbenchRoute.focusCanvasSelection;

  const {
    authReady: apAuthReady,
    deleteWorkload,
    pauseWorkload,
    restartWorkload,
    startWorkload,
  } = useApLifecycleOperations({
    kubeconfig: readOnly ? undefined : options?.kubeconfig,
  });
  const {
    authReady: dbAuthReady,
    clearPublicAccessPendingTarget,
    deleteWorkload: deleteDbWorkload,
    getPublicAccessPendingTarget,
    isLoading: isDbLifecycleLoading,
    restartWorkload: restartDbWorkload,
    startWorkload: startDbWorkload,
    stopWorkload: stopDbWorkload,
    togglePublicAccess,
  } = useDbLifecycleOperations({
    kubeconfig: readOnly ? undefined : options?.kubeconfig,
  });

  const refreshWorkloadLists = options?.refreshWorkloadLists;
  const onPendingApDbReferencesStart = options?.onPendingApDbReferencesStart;
  const onNodeExpansionChange = options?.onNodeExpansionChange;
  const onNodePositionChange = options?.onNodePositionChange;
  const onNodeStackOrderChange = options?.onNodeStackOrderChange;
  const dbDsnReferenceSources = useMemo(
    () =>
      dbDsnReferenceSourcesFromDbsData(options?.dbsData, options?.namespace),
    [options?.dbsData, options?.namespace]
  );
  const afterLifecycle = useCallback(async () => {
    try {
      await refreshWorkloadLists?.();
    } catch {
      // ignore refresh failures; list will reconcile on next poll
    }
  }, [refreshWorkloadLists]);

  const handleAddDbDsnReferenceIntentConsumed = useCallback((id: string) => {
    setPendingAddDbDsnReferenceIntent((current) =>
      current?.id === id ? null : current
    );
  }, []);

  const runMutationThenRefresh = useCallback(
    (
      mutation: () => Promise<unknown>,
      copy: { loading: string; success: string },
      options?: { onSettled?: () => void }
    ) => {
      toast.promise(
        (async (): Promise<void> => {
          try {
            await mutation();
            await afterLifecycle();
          } finally {
            options?.onSettled?.();
          }
        })(),
        {
          error: (err) =>
            err instanceof Error ? err.message : "Operation failed",
          loading: copy.loading,
          success: copy.success,
        }
      );
    },
    [afterLifecycle]
  );

  const copyDatabaseConnection = useCallback<DatabaseNodeCopyConnectionHandler>(
    async (connection) => {
      const value = connection.value;
      if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Copy feedback is handled by the row; clipboard failures should not break canvas interactions.
      }
    },
    []
  );

  const decorateDatabaseNode = useCallback(
    (node: Node): Node => {
      const data = node.data as CanvasDatabaseNodeData;
      const workload = data.workload;
      const name = workload.name.trim();
      const namespace = workload.namespace.trim();
      const canTogglePublicAccess =
        dbAuthReady && name !== "" && namespace !== "";
      const canUseLifecycle = dbAuthReady && name !== "" && namespace !== "";
      const publicAccessPendingTarget = getPublicAccessPendingTarget(workload);
      const connections = resolveDatabasePublicConnections(
        data.connections,
        publicAccessPendingTarget
      );
      const togglePublicConnection:
        | DatabaseNodeTogglePublicConnectionHandler
        | undefined = canTogglePublicAccess
        ? (_connection, _index, nextEnabled) => {
            runMutationThenRefresh(
              () =>
                togglePublicAccess(workload, nextEnabled, {
                  metadata: data.metadata,
                  routingDomain,
                }),
              {
                loading: nextEnabled
                  ? `Enabling public access for "${name}"...`
                  : `Disabling public access for "${name}"...`,
                success: nextEnabled
                  ? `Enabled public access for "${name}"`
                  : `Disabled public access for "${name}"`,
              },
              {
                onSettled: () => clearPublicAccessPendingTarget(workload),
              }
            );
          }
        : undefined;
      const dbLifecycleAction = (
        action: DatabaseNodeLifecycleActionKey,
        mutation: () => Promise<unknown>,
        copy: { loading: string; success: string }
      ) => ({
        loading: isDbLifecycleLoading(workload, action),
        onClick: () => runMutationThenRefresh(mutation, copy),
      });
      const displayName = data.states.name || name;
      const target = projectDbTargetFromNode(node);
      const selection = projectCanvasSelectionFromNode(node);
      const hasSurfaceActions = target != null;
      const lifecycleActions = canUseLifecycle
        ? {
            delete: dbLifecycleAction(
              "delete",
              () => deleteDbWorkload(workload),
              {
                loading: `Deleting "${displayName}"...`,
                success: `Deleted "${displayName}"`,
              }
            ),
            restart: dbLifecycleAction(
              "restart",
              () => restartDbWorkload(workload),
              {
                loading: `Restarting "${displayName}"...`,
                success: `Restart requested for "${displayName}"`,
              }
            ),
            start: dbLifecycleAction("start", () => startDbWorkload(workload), {
              loading: `Starting "${displayName}"...`,
              success: `Start requested for "${displayName}"`,
            }),
            stop: dbLifecycleAction("stop", () => stopDbWorkload(workload), {
              loading: `Stopping "${displayName}"...`,
              success: `Stop requested for "${displayName}"`,
            }),
          }
        : undefined;

      const databasePaneQuickAction = (
        pane: (typeof DATABASE_PANE)[keyof typeof DATABASE_PANE]
      ) => ({
        disabled: !hasSurfaceActions,
        onClick: target
          ? () => {
              if (pane === DATABASE_PANE.logs) {
                openMainSurface(mainSurfaceForResourceLogs(target), selection);
                return;
              }
              if (pane === DATABASE_PANE.console) {
                openDrawerSurface(drawerSurfaceForDbConsole(target), selection);
                return;
              }
              const entry = sideSurfaceForDatabasePane(target, pane);
              if (entry != null) {
                openSideSurface(entry, selection);
              }
            }
          : undefined,
      });

      return {
        ...node,
        data: {
          ...data,
          actions: {
            ...(data.actions ?? {}),
            copyConnection: copyDatabaseConnection,
            ...(togglePublicConnection === undefined
              ? {}
              : { togglePublicConnection }),
            ...(lifecycleActions === undefined ? {} : { lifecycleActions }),
            quickActions: {
              ...(data.actions?.quickActions ?? {}),
              dbAccess: {
                disabled: !hasSurfaceActions,
                onClick: target
                  ? () => {
                      openMainSurface(
                        mainSurfaceForDbAccess(target),
                        selection
                      );
                    }
                  : undefined,
              },
              metrics: databasePaneQuickAction(DATABASE_PANE.metrics),
              logs: databasePaneQuickAction(DATABASE_PANE.logs),
              console: databasePaneQuickAction(DATABASE_PANE.console),
            },
          },
          connections,
          settingsAccess: canvasNodeSettingsAccess({
            readOnly,
          }),
        },
      };
    },
    [
      copyDatabaseConnection,
      clearPublicAccessPendingTarget,
      dbAuthReady,
      deleteDbWorkload,
      getPublicAccessPendingTarget,
      isDbLifecycleLoading,
      openDrawerSurface,
      openMainSurface,
      openSideSurface,
      restartDbWorkload,
      runMutationThenRefresh,
      readOnly,
      routingDomain,
      startDbWorkload,
      stopDbWorkload,
      togglePublicAccess,
    ]
  );

  const decorateContainerNode = useCallback(
    (node: Node): Node => {
      const data = node.data as CanvasContainerNodeData;
      const states = data.states;
      const ns = states.namespace?.trim() ?? "";
      const name = states.name.trim();
      const target = projectApTargetFromNode(node);
      const selection = projectCanvasSelectionFromNode(node);

      const isApLifecycle =
        apAuthReady && states.kind === "AP" && ns !== "" && name !== "";

      const hasSurfaceActions = target != null;
      const dbReferenceIntentData = dbReferenceIntentDataForContainerNode({
        intent: pendingAddDbDsnReferenceIntent,
        nodeId: node.id,
        onConsumed: handleAddDbDsnReferenceIntentConsumed,
      });
      const settingsAccess = canvasNodeSettingsAccess({
        readOnly,
      });
      const onAddDbDsnReferenceMutationStart =
        createPendingApDbReferenceMutationStartHandler({
          apName: name,
          apNamespace: ns,
          onPendingApDbReferencesStart,
        });

      if (!(hasSurfaceActions || isApLifecycle)) {
        return {
          ...node,
          data: {
            ...data,
            dbDsnReferenceSources,
            ...dbReferenceIntentData,
            onAddDbDsnReferenceMutationStart,
            settingsAccess,
          },
        };
      }

      const select = (pane: string) => {
        if (target == null) {
          return;
        }
        if (pane === WORKLOAD_PANE.terminal) {
          openDrawerSurface(drawerSurfaceForApTerminal(target), selection);
          return;
        }
        if (pane === WORKLOAD_PANE.logs) {
          openMainSurface(mainSurfaceForResourceLogs(target), selection);
          return;
        }
        const entry = sideSurfaceForWorkloadPane(target, pane);
        if (entry != null) {
          openSideSurface(entry, selection);
        }
      };

      const ref = { name: states.name, namespace: ns };
      const displayName = states.name;
      const lifecycleActions = isApLifecycle
        ? {
            delete: {
              onClick: () =>
                runMutationThenRefresh(() => deleteWorkload(ref), {
                  loading: `Deleting "${displayName}"...`,
                  success: `Deleted "${displayName}"`,
                }),
            },
            restart: {
              onClick: () =>
                runMutationThenRefresh(() => restartWorkload(ref), {
                  loading: `Restarting "${displayName}"...`,
                  success: `Restarted "${displayName}"`,
                }),
            },
            start: {
              onClick: () =>
                runMutationThenRefresh(() => startWorkload(ref), {
                  loading: `Starting "${displayName}"...`,
                  success: `Started "${displayName}"`,
                }),
            },
            stop: {
              onClick: () =>
                runMutationThenRefresh(() => pauseWorkload(ref), {
                  loading: `Stopping "${displayName}"...`,
                  success: `Stop requested for "${displayName}"`,
                }),
            },
          }
        : undefined;
      const quickActions = {
        ...(data.actions?.quickActions ?? {}),
        calendar: {
          disabled: !hasSurfaceActions,
          onClick: () => select(WORKLOAD_PANE.history),
        },
        console: {
          disabled: !hasSurfaceActions,
          onClick: () => select(WORKLOAD_PANE.terminal),
        },
        logs: {
          disabled: !hasSurfaceActions,
          onClick: () => select(WORKLOAD_PANE.logs),
        },
        events: {
          disabled: !hasSurfaceActions,
          onClick: () => select(WORKLOAD_PANE.events),
        },
        metrics: {
          disabled: !hasSurfaceActions,
          onClick: () => select(WORKLOAD_PANE.metrics),
        },
      };

      return {
        ...node,
        data: {
          ...data,
          ...dbReferenceIntentData,
          dbDsnReferenceSources,
          onAddDbDsnReferenceMutationStart,
          onWorkloadMutation: afterLifecycle,
          settingsAccess,
          actions: {
            ...(data.actions ?? {}),
            ...(lifecycleActions === undefined ? {} : { lifecycleActions }),
            quickActions,
          },
        },
      };
    },
    [
      apAuthReady,
      afterLifecycle,
      dbDsnReferenceSources,
      deleteWorkload,
      handleAddDbDsnReferenceIntentConsumed,
      onPendingApDbReferencesStart,
      openDrawerSurface,
      openMainSurface,
      openSideSurface,
      pendingAddDbDsnReferenceIntent,
      pauseWorkload,
      readOnly,
      restartWorkload,
      runMutationThenRefresh,
      startWorkload,
    ]
  );

  const decorateLayoutNode = useCallback(
    (node: Node): Node => {
      if (readOnly || onNodeExpansionChange === undefined) {
        return node;
      }

      const data = node.data as Record<string, unknown> & {
        layout?: CanvasNodeLayoutState;
      };
      return {
        ...node,
        data: {
          ...data,
          layout: {
            ...(data.layout ?? {}),
            onExpandedChange: (nextNode: Node) => {
              onNodeExpansionChange(nextNode);
            },
          },
        },
      };
    },
    [onNodeExpansionChange, readOnly]
  );

  const stackOrderedRawNodes = useMemo(() => {
    const overridden = rawNodes.map((node) => {
      const key = canvasNodeResourceStackKey(node);
      const stackOrder =
        key === undefined ? undefined : localStackOrderByRef.get(key);
      return stackOrder === undefined
        ? node
        : nodeWithCanvasStackOrder(node, stackOrder);
    });
    return applyCanvasStackOrderToNodes(overridden);
  }, [localStackOrderByRef, rawNodes]);

  const nodes = useMemo(
    () =>
      stackOrderedRawNodes.map((node): Node => {
        const layoutNode = decorateLayoutNode(node);

        if (layoutNode.type === CANVAS_DATABASE_NODE_TYPE) {
          return decorateDatabaseNode(layoutNode);
        }

        if (layoutNode.type === CANVAS_CONTAINER_NODE_TYPE) {
          return decorateContainerNode(layoutNode);
        }

        return layoutNode;
      }),
    [
      decorateContainerNode,
      decorateDatabaseNode,
      decorateLayoutNode,
      stackOrderedRawNodes,
    ]
  );

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
  const sideTarget = projectSurfaceEntryTarget(side);
  const mainTarget = projectSurfaceEntryTarget(main);
  const drawerTarget = projectSurfaceEntryTarget(drawer);
  const sideNode = useMemo(
    () => findCanvasNodeForProjectTarget(nodes, sideTarget),
    [nodes, sideTarget]
  );
  const mainNode = useMemo(
    () => findCanvasNodeForProjectTarget(nodes, mainTarget),
    [nodes, mainTarget]
  );
  const drawerNode = useMemo(
    () => findCanvasNodeForProjectTarget(nodes, drawerTarget),
    [nodes, drawerTarget]
  );
  const selectedEntryRef = useMemo(
    () => selectedEntryRefFromSurfaceState({ selected, side }),
    [selected, side]
  );

  const frontCanvasNode = useCallback(
    (node: Node) => {
      const sourceNodes = nodes.map((candidate) =>
        candidate.id === node.id
          ? { ...candidate, position: { ...node.position } }
          : candidate
      );
      const result = bringCanvasNodeToFrontInStackOrder(sourceNodes, node.id);
      const nextNode = result.node;
      if (!result.changed || nextNode === undefined) {
        return;
      }

      const key = canvasNodeResourceStackKey(nextNode);
      const stackOrder = canvasNodeStackOrder(nextNode);
      if (key !== undefined && stackOrder !== undefined) {
        setLocalStackOrderByRef((current) => {
          if (current.get(key) === stackOrder) {
            return current;
          }
          const next = new Map(current);
          next.set(key, stackOrder);
          return next;
        });
      }

      if (!readOnly) {
        onNodeStackOrderChange?.(nextNode);
      }
    },
    [nodes, onNodeStackOrderChange, readOnly]
  );

  useEffect(() => {
    if (selectedNode == null) {
      return;
    }
    frontCanvasNode(selectedNode);
  }, [frontCanvasNode, selectedNode]);

  const handleConnect = useCallback<
    NonNullable<CanvasReactFlowProps["onConnect"]>
  >(
    (connection) => {
      connectHandledInGestureRef.current = true;
      const command = classifyProjectCanvasConnectionCommand({
        connection,
        nodes,
        readOnly,
      });

      if (command.kind === "discard") {
        if (command.reason === "unsupported") {
          toast.info("That canvas connection is not supported yet.");
        }
        return;
      }

      const apTarget = projectApTarget({
        name: command.ap.name,
        namespace: command.ap.namespace,
        observedUid: command.ap.uid,
      });
      if (apTarget == null) {
        toast.error("Could not open AP settings for this connection.");
        return;
      }

      requestSettingsLeave("switch", () => {
        addDbDsnReferenceIntentCounter.current += 1;
        setPendingAddDbDsnReferenceIntent({
          apNodeId: command.ap.nodeId,
          dbName: command.db.name,
          dbNamespace: command.db.namespace,
          id: `ap-db-${addDbDsnReferenceIntentCounter.current}`,
        });
        openSideSurface(
          { kind: "apSettings", target: apTarget },
          { kind: "resource", target: apTarget }
        );
      });
    },
    [nodes, readOnly, openSideSurface, requestSettingsLeave]
  );
  const isSupportedCanvasConnection = useCallback(
    (connection: Connection) =>
      isProjectCanvasConnectionSupported({
        connection,
        nodes,
        readOnly,
      }),
    [nodes, readOnly]
  );
  const handleConnectStart = useCallback<
    NonNullable<CanvasReactFlowProps["onConnectStart"]>
  >((_event, params) => {
    connectHandledInGestureRef.current = false;
    const fromHandle = connectionHandleFromConnectStartParams(params);
    connectingFromHandleRef.current = fromHandle;
    snappedConnectionInGestureRef.current = null;
    setConnectionOrigin(connectionOriginFromHandle(fromHandle));
    setConnectionGestureActive(true);
  }, []);
  const handleConnectEnd = useCallback<
    NonNullable<CanvasReactFlowProps["onConnectEnd"]>
  >(
    (event, connectionState) => {
      if (!connectHandledInGestureRef.current) {
        const connection = connectionFromProjectCanvasConnectEndGesture({
          event,
          fallbackFromHandle: connectingFromHandleRef.current,
          isSupportedConnection: isSupportedCanvasConnection,
          snappedConnection: snappedConnectionInGestureRef.current,
          state: connectionState,
        });
        if (connection !== undefined) {
          handleConnect(connection);
        }
      }
      connectHandledInGestureRef.current = false;
      connectingFromHandleRef.current = null;
      snappedConnectionInGestureRef.current = null;
      setConnectionOrigin(null);
      setConnectionGestureActive(false);
    },
    [handleConnect, isSupportedCanvasConnection]
  );
  const isValidCanvasConnection = useCallback<
    NonNullable<CanvasReactFlowProps["isValidConnection"]>
  >(
    (connection) =>
      isSupportedCanvasConnection({
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? null,
        target: connection.target,
        targetHandle: connection.targetHandle ?? null,
      }),
    [isSupportedCanvasConnection]
  );
  const projectCanvasConnectionLine = useMemo(
    () =>
      createProjectCanvasConnectionLine({
        isSupportedConnection: isSupportedCanvasConnection,
        onSnappedConnectionChange: (connection) => {
          snappedConnectionInGestureRef.current = connection;
        },
      }),
    [isSupportedCanvasConnection]
  );

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
    clearCanvasFocus();
  }, [clearCanvasFocus]);

  const requestResourcePaneReplacement = useCallback(
    (continueReplace: () => void) => {
      requestSettingsLeave("switch", continueReplace);
    },
    [requestSettingsLeave]
  );

  const closeResourcePane = closeSideSurface;
  const closeResourceLogsSurface = closeMainSurface;

  const sideWorkloadPane = sideWorkloadPaneFromEntry(side);
  const sideDatabasePane = sideDatabasePaneFromEntry(side);
  const sideEntryPane = sideEntryPaneFromEntry(side);
  const mainWorkloadPane = mainWorkloadPaneFromEntry(main);
  const mainDatabasePane = mainDatabasePaneFromEntry(main);
  const drawerWorkloadPane = drawerWorkloadPaneFromEntry(drawer);
  const drawerDatabasePane = drawerDatabasePaneFromEntry(drawer);

  const meta = useMemo<CanvasMeta>(
    () => ({
      edgeAnchorResolver: ({
        dragging,
        previousPair,
        sourceNode,
        targetNode,
      }) =>
        selectCanvasAnchorPair({
          dragging,
          previousPair,
          source: canvasNodeGeometryFromNode(sourceNode),
          target: canvasNodeGeometryFromNode(targetNode),
        }),
      nodeTypes: projectCanvasFlowNodeTypes,
      reactFlowProps: {
        ...projectCanvasInteractionProps({
          isValidConnection: isValidCanvasConnection,
          onConnect: handleConnect,
          onConnectEnd: handleConnectEnd,
          onConnectStart: handleConnectStart,
          readOnly,
        }),
        className: connectionGestureActive
          ? "project-canvas-connection-active"
          : undefined,
        connectionLineComponent: readOnly
          ? undefined
          : projectCanvasConnectionLine,
        onNodeClick: (_, node: Node) => {
          const nextSelection = projectCanvasSelectionFromNode(node);
          const nextSide = defaultProjectSideSurfaceForNode(node);
          const selectNode = () => {
            frontCanvasNode(node);
            if (nextSide != null) {
              openSideSurface(nextSide, nextSelection);
              return;
            }
            writeSelection(nextSelection);
          };

          selectNode();
        },
        onNodeDragStart: (_, node: Node) => {
          frontCanvasNode(node);
        },
        onEdgeClick: (_, edge: Edge) => {
          focusCanvasSelection({
            edgeId: edge.id,
            kind: "edge",
          });
        },
        onNodeDragStop: (_, node: Node) => {
          if (!readOnly) {
            onNodePositionChange?.(node);
          }
        },
        onPaneClick: () => clearSelection(),
      },
    }),
    [
      clearSelection,
      connectionGestureActive,
      frontCanvasNode,
      focusCanvasSelection,
      handleConnect,
      handleConnectEnd,
      handleConnectStart,
      isValidCanvasConnection,
      onNodePositionChange,
      openSideSurface,
      projectCanvasConnectionLine,
      readOnly,
      writeSelection,
    ]
  );

  return {
    clearSelection,
    closeDrawerSurface,
    closeMainSurface,
    closeResourceLogsSurface,
    closeResourcePane,
    closeSideSurface,
    connectionOrigin,
    drawer,
    drawerDatabasePane,
    drawerNode,
    drawerWorkloadPane,
    main,
    mainDatabasePane,
    mainNode,
    mainWorkloadPane,
    meta,
    nodes,
    openDrawerSurface,
    openMainSurface,
    openSideSurface,
    registerSettingsLeaveGuard,
    requestResourcePaneReplacement,
    selected,
    selectedEntryRef,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    side,
    sideDatabasePane,
    sideEntryPane,
    sideNode,
    sideVisible: projectSideSurfaceVisible(surfaceState),
    sideWorkloadPane,
  };
}
