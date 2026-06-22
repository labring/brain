"use client";

import type { ContainerNodeQuickActionKey } from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeQuickActionKey,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import type { PendingApDbCanvasReference } from "@/features/project-canvas/flow/pending-connections";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasNodeLayoutState,
} from "@/features/project-canvas/nodes/types";
import {
  projectApTargetFromNode,
  projectDbTargetFromNode,
} from "@/features/project-canvas/surface/selection";
import {
  type ProjectCanvasCommandPlan,
  planProjectCanvasCommand,
} from "@/features/project-canvas/workbench/command-model";
import {
  createPendingApDbReferenceMutationStartHandler,
  type PendingApDbReferenceDraftRegistration,
  pendingApDbCanvasReferencesFromDraftReferences,
  pendingApDbReferenceDraftKey,
  pendingApDbReferenceDraftSignature,
} from "@/features/project-canvas/workbench/database-binding-intents";
import type {
  ProjectCanvasApDeleteTarget,
  ProjectCanvasDbDeleteTarget,
} from "@/features/project-canvas/workbench/project-canvas-delete-dialog";
import type { ProjectResourceActions } from "@/features/project-resource-actions/resource-actions";
import {
  type ProjectRuntimeNodeModels,
  projectRuntimeShellLookupFromNodeData,
  selectProjectRuntimeNodeModel,
} from "@/features/project-runtime/resource-models";
import type { ApSettingsPendingDbReference } from "@/features/project-settings/ap/ap-settings-sections";

type NodeDecorator = (node: Node) => Node;

function decorateRuntimeContainerModel({
  decorateContainerNode,
  node,
  runtimeNodeModels,
}: {
  decorateContainerNode: NodeDecorator;
  node: Node;
  runtimeNodeModels: ProjectRuntimeNodeModels;
}): [string, CanvasContainerNodeData] | null {
  const runtimeLookup = projectRuntimeShellLookupFromNodeData(node.data);
  const model = selectProjectRuntimeNodeModel(runtimeNodeModels, runtimeLookup);
  if (runtimeLookup === undefined || model?.resourceKind !== "ap") {
    return null;
  }

  const decorated = decorateContainerNode({ ...node, data: model });
  return [
    runtimeLookup.modelKey,
    { ...model, ...decorated.data } as CanvasContainerNodeData,
  ];
}

function decorateRuntimeDatabaseModel({
  decorateDatabaseNode,
  node,
  runtimeNodeModels,
}: {
  decorateDatabaseNode: NodeDecorator;
  node: Node;
  runtimeNodeModels: ProjectRuntimeNodeModels;
}): [string, CanvasDatabaseNodeData] | null {
  const runtimeLookup = projectRuntimeShellLookupFromNodeData(node.data);
  const model = selectProjectRuntimeNodeModel(runtimeNodeModels, runtimeLookup);
  if (
    runtimeLookup === undefined ||
    model === undefined ||
    !("workload" in model)
  ) {
    return null;
  }

  const decorated = decorateDatabaseNode({ ...node, data: model });
  return [
    runtimeLookup.modelKey,
    { ...model, ...decorated.data } as CanvasDatabaseNodeData,
  ];
}

function decorateProjectRuntimeNodeModels({
  decorateContainerNode,
  decorateDatabaseNode,
  nodes,
  runtimeNodeModels,
}: {
  decorateContainerNode: NodeDecorator;
  decorateDatabaseNode: NodeDecorator;
  nodes: readonly Node[];
  runtimeNodeModels?: ProjectRuntimeNodeModels;
}): ProjectRuntimeNodeModels | undefined {
  if (runtimeNodeModels === undefined) {
    return undefined;
  }

  const containerModelsByKey = new Map(runtimeNodeModels.containerModelsByKey);
  const databaseModelsByKey = new Map(runtimeNodeModels.databaseModelsByKey);

  for (const node of nodes) {
    const containerModel =
      node.type === CANVAS_CONTAINER_NODE_TYPE
        ? decorateRuntimeContainerModel({
            decorateContainerNode,
            node,
            runtimeNodeModels,
          })
        : null;
    const databaseModel =
      node.type === CANVAS_DATABASE_NODE_TYPE
        ? decorateRuntimeDatabaseModel({
            decorateDatabaseNode,
            node,
            runtimeNodeModels,
          })
        : null;
    if (containerModel !== null) {
      containerModelsByKey.set(...containerModel);
    }
    if (databaseModel !== null) {
      databaseModelsByKey.set(...databaseModel);
    }
  }

  return {
    containerModelsByKey,
    databaseModelsByKey,
    entryModelsByKey: runtimeNodeModels.entryModelsByKey,
  };
}

export function useProjectCanvasNodeDecorators({
  executeCommandPlan,
  nodes,
  onNodeExpansionChange,
  onPendingApDbReferencesStart,
  readOnly,
  requestApDelete,
  requestDbDelete,
  resourceActions,
  runtimeNodeModels,
}: {
  executeCommandPlan: (plan: ProjectCanvasCommandPlan) => void;
  nodes: Node[];
  onNodeExpansionChange?: (node: Node) => void;
  onPendingApDbReferencesStart?: (
    references: readonly PendingApDbCanvasReference[]
  ) => (() => void) | undefined;
  readOnly: boolean;
  requestApDelete: (target: ProjectCanvasApDeleteTarget) => void;
  requestDbDelete: (target: ProjectCanvasDbDeleteTarget) => void;
  resourceActions: ProjectResourceActions;
  runtimeNodeModels?: ProjectRuntimeNodeModels;
}) {
  const pendingApDbReferenceDraftByApKey = useRef<
    Map<string, PendingApDbReferenceDraftRegistration>
  >(new Map());
  const pendingDbReferencesChangeHandlerByApKey = useRef<
    Map<string, (references: readonly ApSettingsPendingDbReference[]) => void>
  >(new Map());

  const {
    apLifecycle,
    copyDatabaseConnection,
    dbLifecycle,
    runResourceAction,
    toggleDatabasePublicAccess,
  } = resourceActions;
  const {
    authReady: apAuthReady,
    pauseWorkload,
    restartWorkload,
    startWorkload,
  } = apLifecycle;
  const {
    authReady: dbAuthReady,
    clearPublicAccessPendingTarget,
    getPublicAccessPendingTarget,
    isLoading: isDbLifecycleLoading,
    restartWorkload: restartDbWorkload,
    startWorkload: startDbWorkload,
    stopWorkload: stopDbWorkload,
  } = dbLifecycle;

  const startPendingDbReference = useCallback(
    (
      _reference: NonNullable<ProjectCanvasCommandPlan["pendingDbReference"]>
    ) => {
      /* Settings Launch Context carries this intent. */
    },
    []
  );

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
  const apSettingsSessionEventsForAp = useCallback(
    ({ name, namespace }: { name: string; namespace: string }) => {
      const apName = name.trim();
      const apNamespace = namespace.trim();
      return {
        onAddDbDsnReferenceMutationStart:
          createPendingApDbReferenceMutationStartHandler({
            apName,
            apNamespace,
            onBeforeStart: () => {
              const draftByApKey = pendingApDbReferenceDraftByApKey.current;
              const draftKey = pendingApDbReferenceDraftKey({
                apName,
                apNamespace,
              });
              draftByApKey.get(draftKey)?.cleanup?.();
              draftByApKey.delete(draftKey);
            },
            onPendingApDbReferencesStart,
          }),
        onPendingDbReferencesChange: pendingDbReferencesChangeHandlerForAp({
          apName,
          apNamespace,
        }),
      };
    },
    [onPendingApDbReferencesStart, pendingDbReferencesChangeHandlerForAp]
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
                requestDbDelete({
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
                  nodes,
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
        },
      };
    },
    [
      clearPublicAccessPendingTarget,
      copyDatabaseConnection,
      dbAuthReady,
      executeCommandPlan,
      getPublicAccessPendingTarget,
      isDbLifecycleLoading,
      nodes,
      readOnly,
      requestDbDelete,
      restartDbWorkload,
      runResourceAction,
      startDbWorkload,
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

      if (!(hasSurfaceActions || isApLifecycle)) {
        return {
          ...node,
          data: {
            ...data,
          },
        };
      }

      const containerQuickAction = (action: ContainerNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        onClick: () =>
          executeCommandPlan(
            planProjectCanvasCommand({
              intent: { action, kind: "containerQuickAction", node },
              nodes,
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
                requestApDelete({
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
      executeCommandPlan,
      nodes,
      pauseWorkload,
      readOnly,
      requestApDelete,
      restartWorkload,
      runResourceAction,
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

  const decoratedNodes = useMemo(
    () =>
      nodes.map((node): Node => {
        const layoutNode = decorateLayoutNode(node);
        if (
          projectRuntimeShellLookupFromNodeData(layoutNode.data) !== undefined
        ) {
          return layoutNode;
        }

        if (layoutNode.type === CANVAS_DATABASE_NODE_TYPE) {
          return decorateDatabaseNode(layoutNode);
        }

        if (layoutNode.type === CANVAS_CONTAINER_NODE_TYPE) {
          return decorateContainerNode(layoutNode);
        }

        return layoutNode;
      }),
    [decorateContainerNode, decorateDatabaseNode, decorateLayoutNode, nodes]
  );

  const decoratedRuntimeNodeModels = useMemo(
    () =>
      decorateProjectRuntimeNodeModels({
        decorateContainerNode,
        decorateDatabaseNode,
        nodes,
        runtimeNodeModels,
      }),
    [decorateContainerNode, decorateDatabaseNode, nodes, runtimeNodeModels]
  );

  return {
    apSettingsSessionEventsForAp,
    nodes: decoratedNodes,
    runtimeNodeModels: decoratedRuntimeNodeModels,
    startPendingDbReference,
  };
}
