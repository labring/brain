"use client";

import type { DbLifecycleWorkloadRef } from "@workspace/api/hooks";
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
  projectCanvasSelectionFromNode,
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
import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
  type ProjectResourceActions,
} from "@/features/project-resource-actions/resource-actions";
import { projectRuntimeShellLookupFromNodeData } from "@/features/project-runtime/resource-models";
import type { ProjectRuntimeNodeModelDecorators } from "@/features/project-runtime/resource-models-react";
import type { ApSettingsPendingDbReference } from "@/features/project-settings/ap/ap-settings-sections";

export function useProjectCanvasNodeDecorators({
  executeCommandPlan,
  nodes,
  onNodeExpansionChange,
  onPendingApDbReferencesStart,
  readOnly,
  requestApDelete,
  requestDbDelete,
  resourceActions,
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
      const target = projectDbTargetFromNode(node);
      const workload = dbLifecycleWorkloadRefFromTarget(target);
      const name = workload?.name ?? "";
      const canTogglePublicAccess = dbAuthReady && workload != null;
      const canUseLifecycle = dbAuthReady && workload != null;
      const publicAccessPendingTarget =
        workload == null ? undefined : getPublicAccessPendingTarget(workload);
      const connections = resolveDatabasePublicConnections(
        data.connections,
        publicAccessPendingTarget
      );
      const togglePublicConnection:
        | DatabaseNodeTogglePublicConnectionHandler
        | undefined =
        canTogglePublicAccess && workload != null
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
        workloadRef: DbLifecycleWorkloadRef,
        action: DatabaseNodeLifecycleActionKey,
        mutation: () => Promise<unknown>,
        copy: { loading: string; success: string }
      ) => ({
        loading: isDbLifecycleLoading(workloadRef, action),
        onClick: () => runResourceAction(mutation, copy),
      });
      const displayName = data.states.name || name;
      const hasSurfaceActions = target != null;
      const lifecycleActions =
        canUseLifecycle && workload != null
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
                workload,
                "restart",
                () => restartDbWorkload(workload),
                {
                  loading: `Restarting "${displayName}"...`,
                  success: `Restart requested for "${displayName}"`,
                }
              ),
              start: dbLifecycleAction(
                workload,
                "start",
                () => startDbWorkload(workload),
                {
                  loading: `Starting "${displayName}"...`,
                  success: `Start requested for "${displayName}"`,
                }
              ),
              stop: dbLifecycleAction(
                workload,
                "stop",
                () => stopDbWorkload(workload),
                {
                  loading: `Stopping "${displayName}"...`,
                  success: `Stop requested for "${displayName}"`,
                }
              ),
            }
          : undefined;

      const databaseQuickAction = (action: DatabaseNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        onClick:
          target == null
            ? undefined
            : () =>
                executeCommandPlan(
                  planProjectCanvasCommand({
                    intent: {
                      action,
                      kind: "databaseQuickAction",
                      selection: projectCanvasSelectionFromNode(node),
                      target,
                    },
                    nodes,
                    readOnly,
                  })
                ),
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
      const target = projectApTargetFromNode(node);
      const workload = apLifecycleWorkloadRefFromTarget(target);
      const ns = workload?.namespace ?? states.namespace?.trim() ?? "";

      const isApLifecycle =
        apAuthReady && states.kind === "AP" && workload != null;

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
        onClick:
          target == null
            ? undefined
            : () =>
                executeCommandPlan(
                  planProjectCanvasCommand({
                    intent: {
                      action,
                      kind: "containerQuickAction",
                      selection: projectCanvasSelectionFromNode(node),
                      target,
                    },
                    nodes,
                    readOnly,
                  })
                ),
      });

      const ref = workload ?? { name: states.name, namespace: ns };
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

  const runtimeModelDecorators = useMemo<ProjectRuntimeNodeModelDecorators>(
    () => ({
      decorateContainerModel: ({ model, node }) => {
        const decorated = decorateContainerNode({ ...node, data: model });
        return { ...model, ...decorated.data } as CanvasContainerNodeData;
      },
      decorateDatabaseModel: ({ model, node }) => {
        const decorated = decorateDatabaseNode({ ...node, data: model });
        return { ...model, ...decorated.data } as CanvasDatabaseNodeData;
      },
    }),
    [decorateContainerNode, decorateDatabaseNode]
  );

  return {
    apSettingsSessionEventsForAp,
    nodes: decoratedNodes,
    runtimeModelDecorators,
  };
}
