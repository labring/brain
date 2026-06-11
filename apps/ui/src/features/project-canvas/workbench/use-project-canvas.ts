"use client";

import {
  useApLifecycleOperations,
  useDbLifecycleOperations,
} from "@workspace/api/hooks";
import type {
  CanvasMeta,
  CanvasReactFlowProps,
  CanvasSelectedNode,
} from "@workspace/ui/components/canvas/canvas.types";
import type { CanvasNodeConnectionSide } from "@workspace/ui/components/canvas-node/canvas-node";
import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeCopyConnectionHandler,
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
import { projectCanvasFlowNodeTypes } from "@/features/project-canvas/canvas-store";
import {
  canvasNodeGeometryFromNode,
  selectCanvasAnchorPair,
} from "@/features/project-canvas/flow/anchor-pair";
import { isProjectCanvasConnectionSupported } from "@/features/project-canvas/flow/connection-command";
import { createProjectCanvasConnectionLine } from "@/features/project-canvas/flow/connection-line";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import {
  connectionFromProjectCanvasConnectEndGesture,
  connectionHandleFromConnectStartParams,
  type ProjectCanvasConnectionHandle,
  projectCanvasInteractionProps,
} from "@/features/project-canvas/flow/interaction";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
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
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasNodeLayoutState,
  CanvasNodeSettingsAccess,
} from "@/features/project-canvas/nodes/types";
import {
  createProjectCanvasSurfaceRenderModel,
  type ProjectCanvasSideRenderModel,
} from "@/features/project-canvas/surface/rendering-adapter";
import {
  findCanvasNodeForProjectTarget,
  projectApTargetFromNode,
  projectDbTargetFromNode,
  projectSelectionNode,
  projectSelectionTargetExists,
  projectTargetExistsOnCanvas,
} from "@/features/project-canvas/surface/selection";
import {
  type ProjectCanvasCommandPlan,
  planProjectCanvasCommand,
} from "@/features/project-canvas/workbench/command-model";
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
import type { ProjectCanvasSelection } from "@/features/project-route-state/canvas-selection";
import { useProjectWorkbenchRouteState } from "@/features/project-route-state/use-project-workbench-route-state";
import type {
  ApSettingsAddDbDsnReferenceIntent,
  ApSettingsPendingDbReference,
} from "@/features/project-settings/ap/ap-settings-sections";
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
  projectId?: string;
  readOnly?: boolean;
  /** Refetch workload list(s) after PATCH/POST/DELETE lifecycle calls. */
  refreshWorkloadLists?: () => Promise<unknown>;
  /** True when the resource lists have settled enough to clear stale URL selections. */
  selectionReady?: boolean;
}

interface PendingAddDbDsnReferenceIntent
  extends ApSettingsAddDbDsnReferenceIntent {
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
const EMPTY_AP_ENVIRONMENT_DB_REFERENCE_SOURCES: ApEnvironmentDbReferenceSource[] =
  [];
export const PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET = 640;

function viewportFocusNodeIdFromSideRenderModel(
  side: ProjectCanvasSideRenderModel
): string | null {
  if (side?.kind !== "resource") {
    return null;
  }

  if (
    side.content.kind === "settings" &&
    side.content.target.target.kind === "AP" &&
    side.content.target.view === "public-addresses"
  ) {
    return side.content.entryNode?.id ?? null;
  }

  if (side.content.kind === "settings") {
    return side.content.node?.id ?? null;
  }

  return side.content.node.id;
}

function sideRenderModelHasViewportFocusSession(
  side: ProjectCanvasSideRenderModel
): boolean {
  return side?.kind === "resource";
}

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
  onBeforeStart,
  onPendingApDbReferencesStart,
}: {
  apName: string;
  apNamespace: string;
  onBeforeStart?: () => void;
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

  return (references) => {
    onBeforeStart?.();
    return onPendingApDbReferencesStart(
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
  };
}

function pendingApDbReferenceDraftKey({
  apName,
  apNamespace,
}: {
  apName: string;
  apNamespace: string;
}): string {
  return `${apNamespace}/${apName}`;
}

function pendingApDbCanvasReferenceId({
  apName,
  apNamespace,
  dbName,
  dbNamespace,
}: {
  apName: string;
  apNamespace: string;
  dbName: string;
  dbNamespace: string;
}): string {
  return `draft:${apNamespace}/${apName}->${dbNamespace}/${dbName}`;
}

function pendingApDbCanvasReferencesFromDraftReferences({
  apName,
  apNamespace,
  references,
}: {
  apName: string;
  apNamespace: string;
  references: readonly ApSettingsPendingDbReference[];
}): PendingApDbCanvasReference[] {
  if (apName === "" || apNamespace === "") {
    return [];
  }
  return references.map((reference) => ({
    id: pendingApDbCanvasReferenceId({
      apName,
      apNamespace,
      dbName: reference.dbName,
      dbNamespace: reference.dbNamespace,
    }),
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
  }));
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

interface PendingApDbReferenceDraftRegistration {
  cleanup?: () => void;
  signature: string;
}

function pendingApDbReferenceDraftSignature(
  references: readonly PendingApDbCanvasReference[]
): string {
  return references
    .map((reference) =>
      [
        reference.id,
        reference.source.kind,
        reference.source.namespace,
        reference.source.name,
        reference.target.kind,
        reference.target.namespace,
        reference.target.name,
      ].join(":")
    )
    .sort()
    .join("|");
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
      runMutationThenRefresh,
      readOnly,
      routingDomain,
      startDbWorkload,
      stackOrderedRawNodes,
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
      apEnvironmentDbReferenceSources,
      executeCommandPlan,
      handleAddDbDsnReferenceIntentConsumed,
      onPendingApDbReferencesStart,
      pendingAddDbDsnReferenceIntent,
      pendingDbReferencesChangeHandlerForAp,
      pauseWorkload,
      readOnly,
      restartWorkload,
      runMutationThenRefresh,
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
    runMutationThenRefresh(
      () => deleteWorkload({ name: target.name, namespace: target.namespace }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      }
    );
  }, [deleteWorkload, pendingApDeleteTarget, runMutationThenRefresh]);
  const confirmPendingDbDelete = useCallback(() => {
    if (pendingDbDeleteTarget == null) {
      return;
    }
    const target = pendingDbDeleteTarget;
    setPendingDbDeleteTarget(null);
    runMutationThenRefresh(
      () =>
        deleteDbWorkload({
          name: target.name,
          namespace: target.namespace,
        }),
      {
        loading: `Deleting "${target.displayName}"...`,
        success: `Deleted "${target.displayName}"`,
      }
    );
  }, [deleteDbWorkload, pendingDbDeleteTarget, runMutationThenRefresh]);
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
          executeCommandPlan(
            planProjectCanvasCommand({
              intent: { kind: "nodeClick", node },
              nodes,
              readOnly,
            })
          );
        },
        onNodeDragStart: (_, node: Node) => {
          frontCanvasNode(node, { persist: false });
        },
        onEdgeClick: (_, edge: Edge) => {
          focusCanvasSelection({
            edgeId: edge.id,
            kind: "edge",
          });
        },
        onNodeDragStop: (_, node: Node) => {
          if (!readOnly) {
            onNodePositionChange?.(
              frontCanvasNode(node, { persist: false }) ?? node
            );
          }
        },
        onPaneClick: () => clearSelection(),
      },
      viewportFocus: {
        active: viewportFocusActive,
        maxZoom: 1.05,
        minZoom: 0.85,
        nodeId: viewportFocusNodeId,
        rightInset: PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET,
      },
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
