"use client";

import type {
  CanvasReactFlowProps,
  CanvasSelectedNode,
} from "@workspace/ui/components/canvas/canvas.types";
import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeQuickActionKey,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import type { Connection, Edge, Node } from "@xyflow/react";
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { isProjectCanvasConnectionSupported } from "@/features/project-canvas/flow/connection-command";
import { createProjectCanvasConnectionLine } from "@/features/project-canvas/flow/connection-line";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import {
  connectionFromProjectCanvasConnectEndGesture,
  connectionHandleFromConnectStartParams,
  type ProjectCanvasConnectionHandle,
} from "@/features/project-canvas/flow/interaction";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  canvasNodeResourceStackKey,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "@/features/project-canvas/layout/node-stack-order";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasNodeLayoutState,
} from "@/features/project-canvas/nodes/types";
import { createProjectCanvasSurfaceRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import {
  findCanvasNodeForProjectTarget,
  projectApTargetFromNode,
  projectDbTargetFromNode,
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
} from "@/features/project-canvas/surface/selection";
import {
  canvasNodeSettingsAccess,
  connectionOriginFromHandle,
  createProjectCanvasMeta,
  type ProjectCanvasConnectionOrigin,
  sideRenderModelHasViewportFocusSession,
  viewportFocusNodeIdFromSideRenderModel,
} from "@/features/project-canvas/workbench/canvas-meta";
import {
  type ProjectCanvasCommandPlan,
  planProjectCanvasCommand,
} from "@/features/project-canvas/workbench/command-model";
import {
  createPendingApDbReferenceMutationStartHandler,
  dbReferenceIntentDataForContainerNode,
  type PendingAddDbDsnReferenceIntent,
  type PendingApDbReferenceDraftRegistration,
  pendingApDbCanvasReferencesFromDraftReferences,
  pendingApDbReferenceDraftKey,
  pendingApDbReferenceDraftSignature,
} from "@/features/project-canvas/workbench/database-binding-intents";
import {
  canvasSelectionForRestoredDbService,
  DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS,
  type PendingDbServiceRestoreFocus,
  restoredDbServiceTargetFromAccepted,
  shouldCancelPendingDbServiceRestoreFocus,
} from "@/features/project-canvas/workbench/db-restore-focus";
import {
  type ProjectCanvasApDeleteTarget,
  type ProjectCanvasDbDeleteTarget,
  ProjectCanvasDeleteDialogs,
} from "@/features/project-canvas/workbench/project-canvas-delete-dialog";
import {
  resourceLayoutRefsForApDelete,
  resourceLayoutRefsForDbDelete,
  useProjectCanvasResourceActions,
} from "@/features/project-canvas/workbench/resource-actions";
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import { useProjectWorkbenchRouteState } from "@/features/project-route-state/use-project-workbench-route-state";
import type { ApSettingsPendingDbReference } from "@/features/project-settings/ap/ap-settings-sections";
import type { ApEnvironmentDbReferenceSource } from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import { useSettingsLeaveGuardController } from "@/features/project-settings/settings-leave-guard-controller";
import type {
  ProjectDrawerSurfaceEntry,
  ProjectMainSurfaceEntry,
  ProjectSideSurfaceEntry,
} from "@/features/project-surfaces/surface-state";
import type { ProjectDbTarget } from "@/features/project-surfaces/target-identity";
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

const EMPTY_AP_ENVIRONMENT_DB_REFERENCE_SOURCES: ApEnvironmentDbReferenceSource[] =
  [];

function commandPlanHasSelection(
  plan: ProjectCanvasCommandPlan
): plan is ProjectCanvasCommandPlan & {
  selection: ProjectCanvasSelection | null;
} {
  return "selection" in plan;
}

interface ProjectCanvasCommandPlanAdapters {
  bringNodeToFront: (nodeId: string) => void;
  openDrawerSurface: (
    entry: ProjectDrawerSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  openMainSurface: (
    entry: ProjectMainSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  openSideSurface: (
    entry: ProjectSideSurfaceEntry,
    selection?: ProjectCanvasSelection | null
  ) => void;
  startPendingDbReference: (
    reference: NonNullable<ProjectCanvasCommandPlan["pendingDbReference"]>
  ) => void;
  writeSelection: (selection: ProjectCanvasSelection | null) => void;
}

function applyCommandFeedback(plan: ProjectCanvasCommandPlan) {
  if (plan.feedback?.tone === "error") {
    toast.error(plan.feedback.message);
    return;
  }
  if (plan.feedback?.tone === "info") {
    toast.info(plan.feedback.message);
  }
}

function applyCommandSurface(
  plan: ProjectCanvasCommandPlan,
  selection: ProjectCanvasSelection | null | undefined,
  adapters: ProjectCanvasCommandPlanAdapters
): boolean {
  if (plan.surface === undefined) {
    return false;
  }

  switch (plan.surface.slot) {
    case "drawer":
      adapters.openDrawerSurface(plan.surface.entry, selection);
      return true;
    case "main":
      adapters.openMainSurface(plan.surface.entry, selection);
      return true;
    case "side":
      adapters.openSideSurface(plan.surface.entry, selection);
      return true;
    default:
      return plan.surface satisfies never;
  }
}

function executeUnguardedCommandPlan(
  plan: ProjectCanvasCommandPlan,
  adapters: ProjectCanvasCommandPlanAdapters
) {
  applyCommandFeedback(plan);

  if (plan.stackOrder?.kind === "bringNodeToFront") {
    adapters.bringNodeToFront(plan.stackOrder.nodeId);
  }

  if (plan.pendingDbReference !== undefined) {
    adapters.startPendingDbReference(plan.pendingDbReference);
  }

  const selection = commandPlanHasSelection(plan) ? plan.selection : undefined;
  if (applyCommandSurface(plan, selection, adapters)) {
    return;
  }

  if (commandPlanHasSelection(plan)) {
    adapters.writeSelection(plan.selection);
  }
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
  const dbServiceRestoreFocusId = useRef(0);
  const pendingApDbReferenceDraftByApKey = useRef<
    Map<string, PendingApDbReferenceDraftRegistration>
  >(new Map());
  const pendingDbReferencesChangeHandlerByApKey = useRef<
    Map<string, (references: readonly ApSettingsPendingDbReference[]) => void>
  >(new Map());
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
  const [pendingDbServiceRestoreFocus, setPendingDbServiceRestoreFocus] =
    useState<PendingDbServiceRestoreFocus | null>(null);
  const [
    restoredDbServiceViewportFocusTarget,
    setRestoredDbServiceViewportFocusTarget,
  ] = useState<ProjectDbTarget | null>(null);
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
          entry.kind === "githubDeployment" ||
          entry.kind === "templateDeployment") &&
        options?.projectId != null
      ) {
        return entry.projectId === options.projectId;
      }
      return true;
    },
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
  const [pendingApDeleteTarget, setPendingApDeleteTarget] =
    useState<ProjectCanvasApDeleteTarget | null>(null);
  const [pendingDbDeleteTarget, setPendingDbDeleteTarget] =
    useState<ProjectCanvasDbDeleteTarget | null>(null);
  const refreshWorkloadLists = options?.refreshWorkloadLists;

  const {
    apLifecycle,
    copyDatabaseConnection,
    dbLifecycle,
    refreshAfterResourceAction,
    runResourceAction,
    toggleDatabasePublicAccess,
  } = useProjectCanvasResourceActions({
    kubeconfig: options?.kubeconfig,
    readOnly,
    refreshWorkloadLists,
    routingDomain,
  });
  const {
    authReady: apAuthReady,
    deleteWorkload,
    pauseWorkload,
    restartWorkload,
    startWorkload,
  } = apLifecycle;
  const {
    authReady: dbAuthReady,
    clearPublicAccessPendingTarget,
    deleteWorkload: deleteDbWorkload,
    getPublicAccessPendingTarget,
    isLoading: isDbLifecycleLoading,
    restartWorkload: restartDbWorkload,
    startWorkload: startDbWorkload,
    stopWorkload: stopDbWorkload,
  } = dbLifecycle;

  const onPendingApDbReferencesStart = options?.onPendingApDbReferencesStart;
  const onNodeExpansionChange = options?.onNodeExpansionChange;
  const onNodePositionChange = options?.onNodePositionChange;
  const onNodeStackOrderChange = options?.onNodeStackOrderChange;
  const onDbServiceRestoreAccepted = useCallback(
    (target: { name: string; namespace: string }) => {
      const restoredTarget = restoredDbServiceTargetFromAccepted(target);
      const sourceTarget =
        surfaceState.main?.kind === "dbAccess"
          ? surfaceState.main.target
          : null;
      refreshWorkloadLists?.().catch(() => undefined);

      if (restoredTarget == null || sourceTarget == null) {
        return;
      }

      dbServiceRestoreFocusId.current += 1;
      setPendingDbServiceRestoreFocus({
        id: dbServiceRestoreFocusId.current,
        restoredTarget,
        sourceTarget,
      });
    },
    [refreshWorkloadLists, surfaceState.main]
  );
  const apEnvironmentDbReferenceSources =
    options?.apEnvironmentDbReferenceSources ??
    EMPTY_AP_ENVIRONMENT_DB_REFERENCE_SOURCES;

  const handleAddDbDsnReferenceIntentConsumed = useCallback((id: string) => {
    setPendingAddDbDsnReferenceIntent((current) =>
      current?.id === id ? null : current
    );
  }, []);
  const handlePendingDbReferencesChange = useCallback(
    (change: {
      apName: string;
      apNamespace: string;
      references: readonly ApSettingsPendingDbReference[];
    }) => {
      const draftByApKey = pendingApDbReferenceDraftByApKey.current;
      const draftKey = pendingApDbReferenceDraftKey({
        apName: change.apName,
        apNamespace: change.apNamespace,
      });
      const references = pendingApDbCanvasReferencesFromDraftReferences({
        apName: change.apName,
        apNamespace: change.apNamespace,
        references: change.references,
      });
      const signature = pendingApDbReferenceDraftSignature(references);
      const existing = draftByApKey.get(draftKey);
      if (existing?.signature === signature) {
        return;
      }

      existing?.cleanup?.();
      draftByApKey.delete(draftKey);

      if (references.length === 0 || onPendingApDbReferencesStart == null) {
        return;
      }

      const cleanup = onPendingApDbReferencesStart(references);
      draftByApKey.set(draftKey, { cleanup, signature });
    },
    [onPendingApDbReferencesStart]
  );
  const handlePendingDbReferencesChangeRef = useRef(
    handlePendingDbReferencesChange
  );
  handlePendingDbReferencesChangeRef.current = handlePendingDbReferencesChange;
  const pendingDbReferencesChangeHandlerForAp = useCallback(
    ({ apName, apNamespace }: { apName: string; apNamespace: string }) => {
      const draftKey = pendingApDbReferenceDraftKey({ apName, apNamespace });
      const existing =
        pendingDbReferencesChangeHandlerByApKey.current.get(draftKey);
      if (existing !== undefined) {
        return existing;
      }

      const handler = (references: readonly ApSettingsPendingDbReference[]) => {
        handlePendingDbReferencesChangeRef.current({
          apName,
          apNamespace,
          references,
        });
      };
      pendingDbReferencesChangeHandlerByApKey.current.set(draftKey, handler);
      return handler;
    },
    []
  );
  useEffect(
    () => () => {
      const draftByApKey = pendingApDbReferenceDraftByApKey.current;
      for (const { cleanup } of draftByApKey.values()) {
        cleanup?.();
      }
      draftByApKey.clear();
      pendingDbReferencesChangeHandlerByApKey.current.clear();
    },
    []
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

  const frontCanvasNode = useCallback(
    (node: Node, options?: { persist?: boolean }) => {
      const sourceNodes = stackOrderedRawNodes.map((candidate) =>
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

      if (!readOnly && options?.persist !== false) {
        onNodeStackOrderChange?.(nextNode);
      }
      return nextNode;
    },
    [onNodeStackOrderChange, readOnly, stackOrderedRawNodes]
  );

  const bringNodeToFrontById = useCallback(
    (nodeId: string) => {
      const node = stackOrderedRawNodes.find(
        (candidate) => candidate.id === nodeId
      );
      if (node !== undefined) {
        frontCanvasNode(node);
      }
    },
    [frontCanvasNode, stackOrderedRawNodes]
  );

  const startPendingDbReference = useCallback(
    (
      reference: NonNullable<ProjectCanvasCommandPlan["pendingDbReference"]>
    ) => {
      addDbDsnReferenceIntentCounter.current += 1;
      setPendingAddDbDsnReferenceIntent({
        ...reference,
        id: `ap-db-${addDbDsnReferenceIntentCounter.current}`,
      });
    },
    []
  );

  const executeCommandPlan = useCallback(
    (plan: ProjectCanvasCommandPlan) => {
      setRestoredDbServiceViewportFocusTarget(null);
      const run = () =>
        executeUnguardedCommandPlan(plan, {
          bringNodeToFront: bringNodeToFrontById,
          openDrawerSurface,
          openMainSurface,
          openSideSurface,
          startPendingDbReference,
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
      startPendingDbReference,
      writeSelection,
    ]
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
            runResourceAction(
              () =>
                toggleDatabasePublicAccess({
                  metadata: data.metadata,
                  nextEnabled,
                  workload,
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
        onClick: () => runResourceAction(mutation, copy),
      });
      const displayName = data.states.name || name;
      const target = projectDbTargetFromNode(node);
      const hasSurfaceActions = target != null;
      const lifecycleActions = canUseLifecycle
        ? {
            delete: {
              loading: isDbLifecycleLoading(workload, "delete"),
              onClick: () =>
                setPendingDbDeleteTarget({
                  displayName,
                  name: workload.name,
                  namespace: workload.namespace,
                }),
            },
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

      const databaseQuickAction = (action: DatabaseNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        onClick: hasSurfaceActions
          ? () =>
              executeCommandPlan(
                planProjectCanvasCommand({
                  intent: { action, kind: "databaseQuickAction", node },
                  nodes: stackOrderedRawNodes,
                  readOnly,
                })
              )
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
                ...databaseQuickAction("dbAccess"),
              },
              metrics: databaseQuickAction("metrics"),
              logs: databaseQuickAction("logs"),
              terminal: databaseQuickAction("terminal"),
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
      executeCommandPlan,
      getPublicAccessPendingTarget,
      isDbLifecycleLoading,
      restartDbWorkload,
      runResourceAction,
      readOnly,
      startDbWorkload,
      stackOrderedRawNodes,
      stopDbWorkload,
      toggleDatabasePublicAccess,
    ]
  );

  const decorateContainerNode = useCallback(
    (node: Node): Node => {
      const data = node.data as CanvasContainerNodeData;
      const states = data.states;
      const ns = states.namespace?.trim() ?? "";
      const name = states.name.trim();
      const target = projectApTargetFromNode(node);

      const isApLifecycle =
        apAuthReady && states.kind === "AP" && ns !== "" && name !== "";

      const hasSurfaceActions = target != null;
      const dbReferenceIntentData = dbReferenceIntentDataForContainerNode({
        intent: pendingAddDbDsnReferenceIntent,
        nodeId: node.id,
        onConsumed: handleAddDbDsnReferenceIntentConsumed,
      });
      const onPendingDbReferencesChange = pendingDbReferencesChangeHandlerForAp(
        {
          apName: name,
          apNamespace: ns,
        }
      );
      const settingsAccess = canvasNodeSettingsAccess({
        readOnly,
      });
      const onAddDbDsnReferenceMutationStart =
        createPendingApDbReferenceMutationStartHandler({
          apName: name,
          apNamespace: ns,
          onBeforeStart: () => {
            const draftByApKey = pendingApDbReferenceDraftByApKey.current;
            const draftKey = pendingApDbReferenceDraftKey({
              apName: name,
              apNamespace: ns,
            });
            draftByApKey.get(draftKey)?.cleanup?.();
            draftByApKey.delete(draftKey);
          },
          onPendingApDbReferencesStart,
        });

      if (!(hasSurfaceActions || isApLifecycle)) {
        return {
          ...node,
          data: {
            ...data,
            dbDsnReferenceSources: apEnvironmentDbReferenceSources,
            ...dbReferenceIntentData,
            onAddDbDsnReferenceMutationStart,
            onPendingDbReferencesChange,
            settingsAccess,
          },
        };
      }

      const containerQuickAction = (action: ContainerNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        onClick: () =>
          executeCommandPlan(
            planProjectCanvasCommand({
              intent: { action, kind: "containerQuickAction", node },
              nodes: stackOrderedRawNodes,
              readOnly,
            })
          ),
      });

      const ref = { name: states.name, namespace: ns };
      const displayName = states.name;
      const lifecycleActions = isApLifecycle
        ? {
            delete: {
              onClick: () =>
                setPendingApDeleteTarget({
                  displayName,
                  kind: states.kind,
                  name: ref.name,
                  namespace: ref.namespace,
                }),
            },
            restart: {
              onClick: () =>
                runResourceAction(() => restartWorkload(ref), {
                  loading: `Restarting "${displayName}"...`,
                  success: `Restarted "${displayName}"`,
                }),
            },
            start: {
              onClick: () =>
                runResourceAction(() => startWorkload(ref), {
                  loading: `Starting "${displayName}"...`,
                  success: `Started "${displayName}"`,
                }),
            },
            stop: {
              onClick: () =>
                runResourceAction(() => pauseWorkload(ref), {
                  loading: `Stopping "${displayName}"...`,
                  success: `Stop requested for "${displayName}"`,
                }),
            },
          }
        : undefined;
      const quickActions = {
        ...(data.actions?.quickActions ?? {}),
        calendar: containerQuickAction("calendar"),
        logs: containerQuickAction("logs"),
        events: containerQuickAction("events"),
        metrics: containerQuickAction("metrics"),
        terminal: containerQuickAction("terminal"),
      };

      return {
        ...node,
        data: {
          ...data,
          ...dbReferenceIntentData,
          dbDsnReferenceSources: apEnvironmentDbReferenceSources,
          onAddDbDsnReferenceMutationStart,
          onPendingDbReferencesChange,
          onWorkloadMutation: refreshAfterResourceAction,
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
      apEnvironmentDbReferenceSources,
      executeCommandPlan,
      handleAddDbDsnReferenceIntentConsumed,
      onPendingApDbReferencesStart,
      pendingAddDbDsnReferenceIntent,
      pendingDbReferencesChangeHandlerForAp,
      pauseWorkload,
      readOnly,
      refreshAfterResourceAction,
      restartWorkload,
      runResourceAction,
      startWorkload,
      stackOrderedRawNodes,
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
  const surfaceRenderModel = useMemo(
    () =>
      createProjectCanvasSurfaceRenderModel({
        nodes,
        surfaceState,
      }),
    [nodes, surfaceState]
  );
  const confirmPendingApDelete = useCallback(() => {
    if (pendingApDeleteTarget == null) {
      return;
    }
    const target = pendingApDeleteTarget;
    setPendingApDeleteTarget(null);
    runResourceAction(
      () => deleteWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      },
      {
        onSuccess: () =>
          options?.onResourceLayoutDelete?.(
            resourceLayoutRefsForApDelete(target)
          ),
      }
    );
  }, [
    deleteWorkload,
    options?.onResourceLayoutDelete,
    pendingApDeleteTarget,
    runResourceAction,
  ]);
  const confirmPendingDbDelete = useCallback(() => {
    if (pendingDbDeleteTarget == null) {
      return;
    }
    const target = pendingDbDeleteTarget;
    setPendingDbDeleteTarget(null);
    runResourceAction(
      () =>
        deleteDbWorkload({
          name: target.name,
          namespace: target.namespace,
        }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      },
      {
        onSuccess: () =>
          options?.onResourceLayoutDelete?.(
            resourceLayoutRefsForDbDelete(target)
          ),
      }
    );
  }, [
    deleteDbWorkload,
    options?.onResourceLayoutDelete,
    pendingDbDeleteTarget,
    runResourceAction,
  ]);
  const resourceDeleteDialog = createElement(ProjectCanvasDeleteDialogs, {
    apTarget: pendingApDeleteTarget,
    dbTarget: pendingDbDeleteTarget,
    onApConfirm: confirmPendingApDelete,
    onApOpenChange: (open: boolean) => {
      if (!open) {
        setPendingApDeleteTarget(null);
      }
    },
    onDbConfirm: confirmPendingDbDelete,
    onDbOpenChange: (open: boolean) => {
      if (!open) {
        setPendingDbDeleteTarget(null);
      }
    },
  });
  const pendingDbServiceRestoreFocusNode = useMemo(
    () =>
      pendingDbServiceRestoreFocus == null
        ? null
        : findCanvasNodeForProjectTarget(
            nodes,
            pendingDbServiceRestoreFocus.restoredTarget
          ),
    [nodes, pendingDbServiceRestoreFocus]
  );
  const restoredDbServiceViewportFocusNodeId = useMemo(
    () =>
      restoredDbServiceViewportFocusTarget == null
        ? null
        : (findCanvasNodeForProjectTarget(
            nodes,
            restoredDbServiceViewportFocusTarget
          )?.id ?? null),
    [nodes, restoredDbServiceViewportFocusTarget]
  );
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
    if (
      pendingDbServiceRestoreFocus == null ||
      !shouldCancelPendingDbServiceRestoreFocus({
        main: surfaceState.main,
        pending: pendingDbServiceRestoreFocus,
      })
    ) {
      return;
    }
    setPendingDbServiceRestoreFocus(null);
  }, [pendingDbServiceRestoreFocus, surfaceState.main]);

  useEffect(() => {
    if (pendingDbServiceRestoreFocus == null) {
      return;
    }
    const pendingId = pendingDbServiceRestoreFocus.id;
    const timeout = window.setTimeout(() => {
      setPendingDbServiceRestoreFocus((current) =>
        current?.id === pendingId ? null : current
      );
    }, DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [pendingDbServiceRestoreFocus]);

  useEffect(() => {
    if (
      pendingDbServiceRestoreFocus == null ||
      pendingDbServiceRestoreFocusNode == null
    ) {
      return;
    }

    const restoredTarget = pendingDbServiceRestoreFocus.restoredTarget;
    setPendingDbServiceRestoreFocus(null);
    setRestoredDbServiceViewportFocusTarget(restoredTarget);
    focusCanvasSelection(canvasSelectionForRestoredDbService(restoredTarget));
  }, [
    focusCanvasSelection,
    pendingDbServiceRestoreFocus,
    pendingDbServiceRestoreFocusNode,
  ]);

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
      executeCommandPlan(
        planProjectCanvasCommand({
          intent: { connection, kind: "connectingEdge" },
          nodes,
          readOnly,
        })
      );
    },
    [executeCommandPlan, nodes, readOnly]
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
    setRestoredDbServiceViewportFocusTarget(null);
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

  const meta = useMemo(
    () =>
      createProjectCanvasMeta({
        clearSelection,
        connectionGestureActive,
        executeCommandPlan,
        focusCanvasSelection,
        frontCanvasNode,
        handleConnect,
        handleConnectEnd,
        handleConnectStart,
        isValidCanvasConnection,
        nodes,
        onNodePositionChange,
        projectCanvasConnectionLine,
        readOnly,
        viewportFocusActive,
        viewportFocusNodeId,
      }),
    [
      clearSelection,
      connectionGestureActive,
      executeCommandPlan,
      frontCanvasNode,
      focusCanvasSelection,
      handleConnect,
      handleConnectEnd,
      handleConnectStart,
      isValidCanvasConnection,
      nodes,
      onNodePositionChange,
      projectCanvasConnectionLine,
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
    connectionOrigin,
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
