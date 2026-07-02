"use client";

import type { DbLifecycleWorkloadRef } from "@workspace/api/hooks";
import type {
  ContainerNodeAction,
  ContainerNodeLifecycleActions,
  ContainerNodeQuickActionKey,
} from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeAction,
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeLifecycleActions,
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
import type {
  ProjectCanvasApStopTarget,
  ProjectCanvasDbStopTarget,
} from "@/features/project-canvas/workbench/project-canvas-stop-dialog";
import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
  type ProjectResourceActions,
} from "@/features/project-resource-actions/resource-actions";
import { projectRuntimeShellLookupFromNodeData } from "@/features/project-runtime/resource-models";
import type { ProjectRuntimeNodeModelDecorators } from "@/features/project-runtime/resource-models-react";
import type { ApSettingsPendingDbReference } from "@/features/project-settings/ap/ap-settings-sections";

const READ_ONLY_RESOURCE_ACTION_REASON =
  "This project is read-only. Resource actions are unavailable.";
const AUTH_UNAVAILABLE_RESOURCE_ACTION_REASON =
  "Resource credentials are not available.";
const MISSING_RESOURCE_TARGET_REASON = "Resource target is unavailable.";

function resourceActionDisabledReason({
  authReady,
  readOnly,
  targetAvailable,
}: {
  authReady: boolean;
  readOnly: boolean;
  targetAvailable: boolean;
}) {
  if (readOnly) {
    return READ_ONLY_RESOURCE_ACTION_REASON;
  }
  if (!authReady) {
    return AUTH_UNAVAILABLE_RESOURCE_ACTION_REASON;
  }
  if (!targetAvailable) {
    return MISSING_RESOURCE_TARGET_REASON;
  }
  return undefined;
}

function unavailableContainerAction(
  disabledReason: string
): ContainerNodeAction {
  return { disabled: true, disabledReason };
}

function unavailableDatabaseAction(disabledReason: string): DatabaseNodeAction {
  return { disabled: true, disabledReason };
}

function unavailableContainerLifecycleActions(
  disabledReason: string | undefined
): ContainerNodeLifecycleActions | undefined {
  if (disabledReason == null) {
    return undefined;
  }
  return {
    delete: unavailableContainerAction(disabledReason),
    restart: unavailableContainerAction(disabledReason),
    start: unavailableContainerAction(disabledReason),
    stop: unavailableContainerAction(disabledReason),
  };
}

function unavailableDatabaseLifecycleActions(
  disabledReason: string | undefined
): DatabaseNodeLifecycleActions | undefined {
  if (disabledReason == null) {
    return undefined;
  }
  return {
    delete: unavailableDatabaseAction(disabledReason),
    restart: unavailableDatabaseAction(disabledReason),
    start: unavailableDatabaseAction(disabledReason),
    stop: unavailableDatabaseAction(disabledReason),
  };
}

export function useProjectCanvasNodeDecorators({
  executeCommandPlan,
  nodes,
  onNodeExpansionChange,
  onPendingApDbReferencesStart,
  readOnly,
  requestApDelete,
  requestApStop,
  requestDbDelete,
  requestDbStop,
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
  requestApStop: (target: ProjectCanvasApStopTarget) => void;
  requestDbDelete: (target: ProjectCanvasDbDeleteTarget) => void;
  requestDbStop: (target: ProjectCanvasDbStopTarget) => void;
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
  } = dbLifecycle;
  const nodesRef = useRef(nodes);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

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
  const handleNodeExpansionChange = useCallback<
    NonNullable<CanvasNodeLayoutState["onExpandedChange"]>
  >(
    (nextNode) => {
      onNodeExpansionChange?.(nextNode);
    },
    [onNodeExpansionChange]
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
      const canUseLifecycle = !readOnly && dbAuthReady && workload != null;
      const lifecycleDisabledReason = resourceActionDisabledReason({
        authReady: dbAuthReady,
        readOnly,
        targetAvailable: workload != null,
      });
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
      const surfaceDisabledReason = hasSurfaceActions
        ? undefined
        : MISSING_RESOURCE_TARGET_REASON;
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
              stop: {
                loading: isDbLifecycleLoading(workload, "stop"),
                onClick: () =>
                  requestDbStop({
                    displayName,
                    name: workload.name,
                    namespace: workload.namespace,
                  }),
              },
            }
          : unavailableDatabaseLifecycleActions(lifecycleDisabledReason);

      const databaseQuickAction = (action: DatabaseNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        disabledReason: surfaceDisabledReason,
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
                    nodes: nodesRef.current,
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
      readOnly,
      requestDbDelete,
      requestDbStop,
      restartDbWorkload,
      runResourceAction,
      startDbWorkload,
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

      const isApKind = states.kind === "AP";
      const canUseLifecycle =
        !readOnly && apAuthReady && isApKind && workload != null;
      const lifecycleDisabledReason = isApKind
        ? resourceActionDisabledReason({
            authReady: apAuthReady,
            readOnly,
            targetAvailable: workload != null,
          })
        : undefined;
      const hasSurfaceActions = target != null;
      const surfaceDisabledReason = hasSurfaceActions
        ? undefined
        : MISSING_RESOURCE_TARGET_REASON;

      const containerQuickAction = (action: ContainerNodeQuickActionKey) => ({
        disabled: !hasSurfaceActions,
        disabledReason: surfaceDisabledReason,
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
                    nodes: nodesRef.current,
                    readOnly,
                  })
                ),
      });

      const ref = workload ?? { name: states.name, namespace: ns };
      const displayName = states.name;
      const lifecycleActions = canUseLifecycle
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
                requestApStop({
                  displayName,
                  kind: states.kind,
                  name: ref.name,
                  namespace: ref.namespace,
                }),
            },
          }
        : unavailableContainerLifecycleActions(lifecycleDisabledReason);
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
      readOnly,
      requestApDelete,
      requestApStop,
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
      if (data.layout?.onExpandedChange === handleNodeExpansionChange) {
        return node;
      }
      return {
        ...node,
        data: {
          ...data,
          layout: {
            ...(data.layout ?? {}),
            onExpandedChange: handleNodeExpansionChange,
          },
        },
      };
    },
    [handleNodeExpansionChange, onNodeExpansionChange, readOnly]
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
