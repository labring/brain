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
import { useAtomValue, useSetAtom } from "jotai";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { shouldClearCanvasActionMode } from "@/lib/project-canvas/actions/canvas-action-mode";
import {
  canvasNodeGeometryFromNode,
  selectCanvasAnchorPair,
} from "@/lib/project-canvas/flow/anchor-pair";
import {
  classifyProjectCanvasConnectionCommand,
  isProjectCanvasConnectionSupported,
} from "@/lib/project-canvas/flow/connection-command";
import { createProjectCanvasConnectionLine } from "@/lib/project-canvas/flow/connection-line";
import { resolveDatabasePublicConnections } from "@/lib/project-canvas/flow/database-public-connection";
import {
  connectionFromProjectCanvasConnectEndGesture,
  connectionHandleFromConnectStartParams,
  type ProjectCanvasConnectionHandle,
  projectCanvasInteractionProps,
} from "@/lib/project-canvas/flow/interaction";
import type { PendingApDbCanvasReference } from "@/lib/project-canvas/flow/pending-connections";
import { dbDsnReferenceSourcesFromDbsData } from "@/lib/project-canvas/k8s/db-dsn-reference-sources";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  canvasNodeResourceStackKey,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "@/lib/project-canvas/layout/node-stack-order";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "@/lib/project-canvas/nodes/constants";
import {
  canvasHasApForEntrySelection,
  entryPointSelectionRefFromKey,
} from "@/lib/project-canvas/nodes/entry-node-selection";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasNodeLayoutState,
  CanvasNodeSettingsAccess,
} from "@/lib/project-canvas/nodes/types";
import {
  databasePaneModeForNodeClick,
  shouldClearDatabasePaneMode,
} from "@/lib/project-canvas/panels/database-panel-mode";
import {
  entryPaneModeForNodeClick,
  normalizeEntryPaneMode,
} from "@/lib/project-canvas/panels/entrypoint-panel-mode";
import { useSettingsLeaveGuardController } from "@/lib/project-canvas/panels/settings-leave-guard";
import {
  shouldClearWorkloadPaneMode,
  workloadPaneModeForNodeClick,
} from "@/lib/project-canvas/panels/workload-pane-mode";
import {
  CANVAS_ACTION,
  CANVAS_ACTION_QUERY_KEY,
  CANVAS_SERVICE_QUERY_KEY,
  DATABASE_PANE,
  DATABASE_PANE_QUERY_KEY,
  ENTRY_PANE_QUERY_KEY,
  projectCanvasFlowNodeTypes,
  projectCanvasNodeServiceUid,
  selectedEdgeAtom,
  WORKLOAD_PANE,
  WORKLOAD_PANE_QUERY_KEY,
} from "@/store/canvas-store";

export interface UseProjectCanvasOptions {
  dbsData?: K8sGetResponse;
  kubeconfig?: string;
  namespace?: string;
  onNodeExpansionChange?: (node: Node) => void;
  onNodePositionChange?: (node: Node) => void;
  onNodeStackOrderChange?: (node: Node) => void;
  onPendingApDbReferencesStart?: (
    references: readonly PendingApDbCanvasReference[]
  ) => (() => void) | undefined;
  onResourcePaneOpen?: () => void;
  readOnly?: boolean;
  /** Refetch workload list(s) after PATCH/POST/DELETE lifecycle calls. */
  refreshWorkloadLists?: () => Promise<unknown>;
  /** True when the resource lists have settled enough to clear stale URL selections. */
  selectionReady?: boolean;
  shareToken?: string;
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
  shareToken,
}: {
  readOnly: boolean;
  shareToken: string | undefined;
}): CanvasNodeSettingsAccess | undefined {
  const st = shareToken?.trim();
  if (!(readOnly || st)) {
    return undefined;
  }
  return {
    ...(readOnly ? { readOnly: true } : {}),
    ...(st ? { shareToken: st } : {}),
  };
}

/**
 * Wires URL-driven workload selection (`?service=`), explicit pane mode,
 * edge selection (Jotai), node toolbar actions, **AP** lifecycle menu actions, and canvas `meta` for `<Canvas.Root />`.
 */
export function useProjectCanvas(
  rawNodes: Node[],
  options?: UseProjectCanvasOptions
) {
  const [serviceUid, setServiceUid] = useQueryState(
    CANVAS_SERVICE_QUERY_KEY,
    parseAsString
  );
  const [workloadPane, setWorkloadPane] = useQueryState(
    WORKLOAD_PANE_QUERY_KEY,
    parseAsString
  );
  const [databasePane, setDatabasePane] = useQueryState(
    DATABASE_PANE_QUERY_KEY,
    parseAsString
  );
  const [entryPane, setEntryPane] = useQueryState(
    ENTRY_PANE_QUERY_KEY,
    parseAsString
  );
  const [canvasAction, setCanvasAction] = useQueryState(
    CANVAS_ACTION_QUERY_KEY,
    parseAsString
  );
  const setSelectedEdge = useSetAtom(selectedEdgeAtom);
  const selectedEdge = useAtomValue(selectedEdgeAtom);
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

  const {
    authReady: apAuthReady,
    deleteWorkload,
    pauseWorkload,
    restartWorkload,
    startWorkload,
  } = useApLifecycleOperations({
    kubeconfig: readOnly ? undefined : options?.kubeconfig,
    shareToken: readOnly ? undefined : options?.shareToken,
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
    shareToken: readOnly ? undefined : options?.shareToken,
  });

  const refreshWorkloadLists = options?.refreshWorkloadLists;
  const onPendingApDbReferencesStart = options?.onPendingApDbReferencesStart;
  const onNodeExpansionChange = options?.onNodeExpansionChange;
  const onNodePositionChange = options?.onNodePositionChange;
  const onNodeStackOrderChange = options?.onNodeStackOrderChange;
  const onResourcePaneOpen = options?.onResourcePaneOpen;
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
      const uid = data.uid?.trim();
      const hasUrlActions = uid != null && uid !== "";
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
        disabled: !hasUrlActions,
        onClick: hasUrlActions
          ? () => {
              requestSettingsLeave("switch", () => {
                if (pane === DATABASE_PANE.logs) {
                  onResourcePaneOpen?.();
                }
                setCanvasAction(null).catch(() => undefined);
                setSelectedEdge(null);
                setServiceUid(uid).catch(() => undefined);
                setEntryPane(null).catch(() => undefined);
                setWorkloadPane(null).catch(() => undefined);
                setDatabasePane(pane).catch(() => undefined);
              });
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
                disabled: !hasUrlActions,
                onClick: hasUrlActions
                  ? () => {
                      requestSettingsLeave("switch", () => {
                        onResourcePaneOpen?.();
                        setSelectedEdge(null);
                        setServiceUid(uid).catch(() => undefined);
                        setEntryPane(null).catch(() => undefined);
                        setWorkloadPane(null).catch(() => undefined);
                        setDatabasePane(null).catch(() => undefined);
                        setCanvasAction(CANVAS_ACTION.dbAccess).catch(
                          () => undefined
                        );
                      });
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
            shareToken: options?.shareToken,
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
      onResourcePaneOpen,
      restartDbWorkload,
      runMutationThenRefresh,
      readOnly,
      requestSettingsLeave,
      routingDomain,
      setCanvasAction,
      setDatabasePane,
      setEntryPane,
      setWorkloadPane,
      startDbWorkload,
      stopDbWorkload,
      setSelectedEdge,
      setServiceUid,
      togglePublicAccess,
      options?.shareToken,
    ]
  );

  const decorateContainerNode = useCallback(
    (node: Node): Node => {
      const data = node.data as CanvasContainerNodeData;
      const states = data.states;
      const uid = states.uid?.trim();
      const ns = states.namespace?.trim() ?? "";
      const name = states.name.trim();

      const isApLifecycle =
        apAuthReady && states.kind === "AP" && ns !== "" && name !== "";

      const hasUrlActions = uid != null && uid !== "";
      const dbReferenceIntentData = dbReferenceIntentDataForContainerNode({
        intent: pendingAddDbDsnReferenceIntent,
        nodeId: node.id,
        onConsumed: handleAddDbDsnReferenceIntentConsumed,
      });
      const settingsAccess = canvasNodeSettingsAccess({
        readOnly,
        shareToken: options?.shareToken,
      });
      const onAddDbDsnReferenceMutationStart =
        createPendingApDbReferenceMutationStartHandler({
          apName: name,
          apNamespace: ns,
          onPendingApDbReferencesStart,
        });

      if (!(hasUrlActions || isApLifecycle)) {
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
        requestSettingsLeave("switch", () => {
          setCanvasAction(null).catch(() => undefined);
          setSelectedEdge(null);
          setDatabasePane(null).catch(() => undefined);
          setEntryPane(null).catch(() => undefined);
          setServiceUid(uid ?? "").catch(() => undefined);
          setWorkloadPane(pane).catch(() => undefined);
          if (pane !== WORKLOAD_PANE.terminal) {
            onResourcePaneOpen?.();
          }
        });
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
          disabled: !hasUrlActions,
          onClick: () => select(WORKLOAD_PANE.history),
        },
        console: {
          disabled: !hasUrlActions,
          onClick: () => select(WORKLOAD_PANE.terminal),
        },
        logs: {
          disabled: !hasUrlActions,
          onClick: () => select(WORKLOAD_PANE.logs),
        },
        events: {
          disabled: !hasUrlActions,
          onClick: () => select(WORKLOAD_PANE.events),
        },
        metrics: {
          disabled: !hasUrlActions,
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
      onResourcePaneOpen,
      options?.shareToken,
      pendingAddDbDsnReferenceIntent,
      pauseWorkload,
      readOnly,
      requestSettingsLeave,
      setCanvasAction,
      restartWorkload,
      runMutationThenRefresh,
      setDatabasePane,
      setEntryPane,
      setSelectedEdge,
      setServiceUid,
      setWorkloadPane,
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

  const selectedNode = useMemo<CanvasSelectedNode>(() => {
    if (!serviceUid) {
      return null;
    }
    return (
      nodes.find((n) => projectCanvasNodeServiceUid(n) === serviceUid) ?? null
    );
  }, [serviceUid, nodes]);
  const selectedEntryRef = useMemo(
    () => entryPointSelectionRefFromKey(serviceUid),
    [serviceUid]
  );
  const selectedEntryApExists = useMemo(
    () =>
      selectedEntryRef == null
        ? false
        : canvasHasApForEntrySelection(rawNodes, selectedEntryRef),
    [rawNodes, selectedEntryRef]
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

      const apUid = command.ap.uid;
      if (apUid == null || apUid === "") {
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
        setCanvasAction(null).catch(() => undefined);
        setSelectedEdge(null);
        setDatabasePane(null).catch(() => undefined);
        setEntryPane(null).catch(() => undefined);
        setServiceUid(apUid).catch(() => undefined);
        setWorkloadPane(WORKLOAD_PANE.settings).catch(() => undefined);
      });
    },
    [
      nodes,
      readOnly,
      requestSettingsLeave,
      setCanvasAction,
      setDatabasePane,
      setEntryPane,
      setSelectedEdge,
      setServiceUid,
      setWorkloadPane,
    ]
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

  const isStale =
    serviceUid != null &&
    serviceUid !== "" &&
    selectionReady &&
    selectedNode == null &&
    !(normalizeEntryPaneMode(entryPane) != null && selectedEntryApExists);

  useEffect(() => {
    if (isStale) {
      setCanvasAction(null).catch(() => undefined);
      setServiceUid(null).catch(() => undefined);
      setEntryPane(null).catch(() => undefined);
    }
  }, [isStale, setCanvasAction, setEntryPane, setServiceUid]);

  useEffect(() => {
    if (entryPane == null) {
      return;
    }
    if (
      normalizeEntryPaneMode(entryPane) == null ||
      selectedEntryRef == null ||
      (selectionReady && !selectedEntryApExists)
    ) {
      setEntryPane(null).catch(() => undefined);
      setServiceUid(null).catch(() => undefined);
    }
  }, [
    entryPane,
    selectionReady,
    selectedEntryApExists,
    selectedEntryRef,
    setEntryPane,
    setServiceUid,
  ]);

  useEffect(() => {
    if (
      shouldClearDatabasePaneMode({
        databasePane,
        rawNodeCount: rawNodes.length,
        selectedNode,
        serviceUid,
      })
    ) {
      setDatabasePane(null).catch(() => undefined);
    }
  }, [
    databasePane,
    rawNodes.length,
    selectedNode,
    serviceUid,
    setDatabasePane,
  ]);

  useEffect(() => {
    if (
      shouldClearCanvasActionMode({
        canvasAction,
        rawNodeCount: rawNodes.length,
        selectedNode,
        serviceUid,
      })
    ) {
      setCanvasAction(null).catch(() => undefined);
    }
  }, [
    canvasAction,
    rawNodes.length,
    selectedNode,
    serviceUid,
    setCanvasAction,
  ]);

  useEffect(() => {
    if (
      shouldClearWorkloadPaneMode({
        rawNodeCount: rawNodes.length,
        selectedNode,
        serviceUid,
        workloadPane,
      })
    ) {
      setWorkloadPane(null).catch(() => undefined);
    }
  }, [
    rawNodes.length,
    selectedNode,
    serviceUid,
    setWorkloadPane,
    workloadPane,
  ]);

  const clearSelectedResource = useCallback(() => {
    setCanvasAction(null).catch(() => undefined);
    setSelectedEdge(null);
    setServiceUid(null).catch(() => undefined);
    setDatabasePane(null).catch(() => undefined);
    setEntryPane(null).catch(() => undefined);
    setWorkloadPane(null).catch(() => undefined);
  }, [
    setCanvasAction,
    setDatabasePane,
    setEntryPane,
    setSelectedEdge,
    setServiceUid,
    setWorkloadPane,
  ]);

  const requestResourcePaneReplacement = useCallback(
    (continueReplace: () => void) => {
      requestSettingsLeave("switch", () => {
        continueReplace();
        clearSelectedResource();
      });
    },
    [clearSelectedResource, requestSettingsLeave]
  );

  const clearSelection = useCallback(() => {
    requestSettingsLeave("close", clearSelectedResource);
  }, [clearSelectedResource, requestSettingsLeave]);

  const closeResourcePane = clearSelection;
  const closeCanvasActionSurface = useCallback(() => {
    setCanvasAction(null).catch(() => undefined);
  }, [setCanvasAction]);
  const closeResourceLogsSurface = useCallback(() => {
    if (databasePane === DATABASE_PANE.logs) {
      setDatabasePane(null).catch(() => undefined);
    }
    if (workloadPane === WORKLOAD_PANE.logs) {
      setWorkloadPane(null).catch(() => undefined);
    }
  }, [databasePane, setDatabasePane, setWorkloadPane, workloadPane]);

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
          const nextWorkloadPane = workloadPaneModeForNodeClick(node);
          const nextDatabasePane = databasePaneModeForNodeClick(node);
          const nextEntryPane = entryPaneModeForNodeClick(node);
          const nextServiceUid = projectCanvasNodeServiceUid(node);
          const nextResourcePaneOpen = Boolean(
            (nextWorkloadPane === WORKLOAD_PANE.terminal
              ? null
              : nextWorkloadPane) ??
              nextDatabasePane ??
              nextEntryPane
          );
          const selectNode = () => {
            frontCanvasNode(node);
            setCanvasAction(null).catch(() => undefined);
            setSelectedEdge(null);
            setWorkloadPane(nextWorkloadPane).catch(() => undefined);
            setDatabasePane(nextDatabasePane).catch(() => undefined);
            setEntryPane(nextEntryPane).catch(() => undefined);
            setServiceUid(nextServiceUid).catch(() => undefined);
            if (nextResourcePaneOpen) {
              onResourcePaneOpen?.();
            }
          };

          if (
            nextServiceUid === serviceUid &&
            nextWorkloadPane === workloadPane &&
            nextDatabasePane === databasePane &&
            nextEntryPane === entryPane
          ) {
            selectNode();
            return;
          }

          requestSettingsLeave("switch", selectNode);
        },
        onNodeDragStart: (_, node: Node) => {
          frontCanvasNode(node);
        },
        onEdgeClick: (_, edge: Edge) => {
          requestSettingsLeave("switch", () => {
            setCanvasAction(null).catch(() => undefined);
            setSelectedEdge(edge);
            setServiceUid(null).catch(() => undefined);
            setDatabasePane(null).catch(() => undefined);
            setEntryPane(null).catch(() => undefined);
            setWorkloadPane(null).catch(() => undefined);
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
      databasePane,
      entryPane,
      frontCanvasNode,
      handleConnect,
      handleConnectEnd,
      handleConnectStart,
      isValidCanvasConnection,
      onNodePositionChange,
      onResourcePaneOpen,
      projectCanvasConnectionLine,
      readOnly,
      requestSettingsLeave,
      serviceUid,
      setCanvasAction,
      setDatabasePane,
      setEntryPane,
      setSelectedEdge,
      setServiceUid,
      setWorkloadPane,
      workloadPane,
    ]
  );

  return {
    canvasAction,
    clearSelection,
    closeCanvasActionSurface,
    closeResourceLogsSurface,
    closeResourcePane,
    connectionOrigin,
    databasePane,
    entryPane,
    meta,
    nodes,
    registerSettingsLeaveGuard,
    requestResourcePaneReplacement,
    selectedEntryRef,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    workloadPane,
  };
}
