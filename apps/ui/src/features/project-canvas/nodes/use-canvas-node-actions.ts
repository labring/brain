"use client";

import type {
  ContainerNodeAction,
  ContainerNodeActions,
  ContainerNodeLifecycleActions,
  ContainerNodeQuickActionKey,
} from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeAction,
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeLifecycleActions,
  DatabaseNodeQuickActionKey,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import { useMemo } from "react";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
} from "@/features/project-canvas/nodes/types";
import {
  projectApTargetFromNode,
  projectCanvasSelectionFromNode,
  projectDbTargetFromNode,
} from "@/features/project-canvas/surface/selection";
import { planProjectCanvasCommand } from "@/features/project-canvas/workbench/command-model";
import {
  useCanvasApLifecycleActivity,
  useCanvasDbLifecycleActivity,
  useProjectCanvasNodeCommands,
} from "@/features/project-canvas/workbench/node-commands-react";
import {
  apLifecycleWorkloadRefFromTarget,
  dbLifecycleWorkloadRefFromTarget,
} from "@/features/project-resource-actions/resource-actions";

const READ_ONLY_RESOURCE_ACTION_REASON =
  "This project is read-only. Resource actions are unavailable.";
const AUTH_UNAVAILABLE_RESOURCE_ACTION_REASON =
  "Resource credentials are not available.";
const MISSING_RESOURCE_TARGET_REASON = "Resource target is unavailable.";

/** Engines whose native client the platform ships for DB Terminal and DB Access. */
const DB_ENGINES_WITH_CLIENT_SUPPORT = new Set([
  "apecloud-mysql",
  "mongodb",
  "mysql",
  "postgresql",
  "redis",
]);
const DB_TERMINAL_UNSUPPORTED_ENGINE_REASON =
  "Terminal is not available for this database engine.";
const DB_ACCESS_UNSUPPORTED_ENGINE_REASON =
  "Database access is not available for this database engine.";

function dbEngineClientSupported(engineKey: string | undefined): boolean {
  const normalized = engineKey?.trim().toLowerCase() ?? "";
  return normalized === "" || DB_ENGINES_WITH_CLIENT_SUPPORT.has(normalized);
}

function databaseLiveSessionUnavailableReasons(engineKey: string | undefined): {
  dbAccessReason?: string;
  terminalReason?: string;
} {
  if (dbEngineClientSupported(engineKey)) {
    return {};
  }
  return {
    dbAccessReason: DB_ACCESS_UNSUPPORTED_ENGINE_REASON,
    terminalReason: DB_TERMINAL_UNSUPPORTED_ENGINE_REASON,
  };
}

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

function selectionNodeFromModel(
  id: string,
  model: CanvasContainerNodeData | CanvasDatabaseNodeData,
  type: string | undefined
): Node {
  return {
    data: model,
    id,
    position: { x: 0, y: 0 },
    type,
  } as Node;
}

/**
 * Builds container node actions from the stable canvas command surface plus
 * this node's lifecycle activity. Returns the model's own actions untouched
 * when no command surface is mounted (component previews, read-only shells).
 */
export function useCanvasContainerNodeActions({
  id,
  model,
  type,
}: {
  id: string;
  model: CanvasContainerNodeData;
  type: string | undefined;
}): ContainerNodeActions {
  const commands = useProjectCanvasNodeCommands();
  const { authReady } = useCanvasApLifecycleActivity();

  return useMemo(() => {
    const base = model.actions ?? {};
    if (commands == null) {
      return base;
    }

    const node = selectionNodeFromModel(id, model, type);
    const states = model.states;
    const target = projectApTargetFromNode(node);
    const workload = apLifecycleWorkloadRefFromTarget(target);
    const ns = workload?.namespace ?? states.namespace?.trim() ?? "";
    const readOnly = commands.readOnly;

    const isApKind = states.kind === "AP";
    const canUseLifecycle =
      !readOnly && authReady && isApKind && workload != null;
    const lifecycleDisabledReason = isApKind
      ? resourceActionDisabledReason({
          authReady,
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
              commands.executeCommandPlan(
                planProjectCanvasCommand({
                  intent: {
                    action,
                    kind: "containerQuickAction",
                    selection: projectCanvasSelectionFromNode(node),
                    target,
                  },
                  nodes: commands.getNodes(),
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
              commands.requestApDelete({
                displayName,
                kind: states.kind,
                name: ref.name,
                namespace: ref.namespace,
              }),
          },
          restart: {
            onClick: () =>
              commands.runResourceAction(
                () => commands.restartApWorkload(ref),
                {
                  loading: `Restarting "${displayName}"...`,
                  success: `Restarted "${displayName}"`,
                }
              ),
          },
          start: {
            onClick: () =>
              commands.runResourceAction(() => commands.startApWorkload(ref), {
                loading: `Starting "${displayName}"...`,
                success: `Started "${displayName}"`,
              }),
          },
          stop: {
            onClick: () =>
              commands.requestApStop({
                displayName,
                kind: states.kind,
                name: ref.name,
                namespace: ref.namespace,
              }),
          },
        }
      : unavailableContainerLifecycleActions(lifecycleDisabledReason);
    const quickActions = {
      ...(base.quickActions ?? {}),
      calendar: containerQuickAction("calendar"),
      logs: containerQuickAction("logs"),
      events: containerQuickAction("events"),
      metrics: containerQuickAction("metrics"),
      terminal: containerQuickAction("terminal"),
    };

    return {
      ...base,
      ...(lifecycleActions === undefined ? {} : { lifecycleActions }),
      quickActions,
    };
  }, [authReady, commands, id, model, type]);
}

export interface CanvasDatabaseNodeViewModel {
  actions: DatabaseNodeActions;
  connections: DatabaseNodeConnection[];
}

/**
 * Builds database node actions and pending-aware connections from the stable
 * canvas command surface plus this node's lifecycle activity.
 */
export function useCanvasDatabaseNodeActions({
  id,
  model,
  type,
}: {
  id: string;
  model: CanvasDatabaseNodeData;
  type: string | undefined;
}): CanvasDatabaseNodeViewModel {
  const commands = useProjectCanvasNodeCommands();
  const workloadRef = useMemo(
    () => ({
      name: model.workload?.name ?? "",
      namespace: model.workload?.namespace ?? "",
    }),
    [model.workload?.name, model.workload?.namespace]
  );
  const activity = useCanvasDbLifecycleActivity(
    workloadRef.name === "" ? null : workloadRef
  );

  return useMemo(() => {
    const base = model.actions ?? {};
    if (commands == null) {
      return { actions: base, connections: model.connections };
    }

    const node = selectionNodeFromModel(id, model, type);
    const target = projectDbTargetFromNode(node);
    const workload = dbLifecycleWorkloadRefFromTarget(target);
    const name = workload?.name ?? "";
    const readOnly = commands.readOnly;
    const canTogglePublicAccess = activity.authReady && workload != null;
    const canUseLifecycle = !readOnly && activity.authReady && workload != null;
    const lifecycleDisabledReason = resourceActionDisabledReason({
      authReady: activity.authReady,
      readOnly,
      targetAvailable: workload != null,
    });
    const connections = resolveDatabasePublicConnections(
      model.connections,
      activity.publicAccessPendingTarget
    );
    const togglePublicConnection:
      | DatabaseNodeTogglePublicConnectionHandler
      | undefined =
      canTogglePublicAccess && workload != null
        ? (_connection, _index, nextEnabled) => {
            commands.runResourceAction(
              () =>
                commands.toggleDatabasePublicAccess({
                  metadata: model.metadata,
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
                onSettled: () =>
                  commands.clearDbPublicAccessPendingTarget(workload),
              }
            );
          }
        : undefined;
    const dbLifecycleAction = (
      loading: boolean,
      mutation: () => Promise<unknown>,
      copy: { loading: string; success: string }
    ) => ({
      loading,
      onClick: () => commands.runResourceAction(mutation, copy),
    });
    const displayName = model.states.name || name;
    const lifecycleActions =
      canUseLifecycle && workload != null
        ? {
            delete: {
              loading: activity.loadingDelete,
              onClick: () =>
                commands.requestDbDelete({
                  displayName,
                  name: workload.name,
                  namespace: workload.namespace,
                }),
            },
            restart: dbLifecycleAction(
              activity.loadingRestart,
              () => commands.restartDbWorkload(workload),
              {
                loading: `Restarting "${displayName}"...`,
                success: `Restart requested for "${displayName}"`,
              }
            ),
            start: dbLifecycleAction(
              activity.loadingStart,
              () => commands.startDbWorkload(workload),
              {
                loading: `Starting "${displayName}"...`,
                success: `Start requested for "${displayName}"`,
              }
            ),
            stop: {
              loading: activity.loadingStop,
              onClick: () =>
                commands.requestDbStop({
                  displayName,
                  name: workload.name,
                  namespace: workload.namespace,
                }),
            },
          }
        : unavailableDatabaseLifecycleActions(lifecycleDisabledReason);

    const databaseQuickAction = (
      action: DatabaseNodeQuickActionKey,
      unavailableReason?: string
    ) => ({
      disabled: target == null || unavailableReason != null,
      disabledReason:
        (target == null ? MISSING_RESOURCE_TARGET_REASON : undefined) ??
        unavailableReason,
      onClick:
        target == null
          ? undefined
          : () =>
              commands.executeCommandPlan(
                planProjectCanvasCommand({
                  intent: {
                    action,
                    kind: "databaseQuickAction",
                    selection: projectCanvasSelectionFromNode(node),
                    target,
                  },
                  nodes: commands.getNodes(),
                  readOnly,
                })
              ),
    });
    const { dbAccessReason, terminalReason } =
      databaseLiveSessionUnavailableReasons(model.states.engineKey);

    const actions: DatabaseNodeActions = {
      ...base,
      copyConnection: commands.copyDatabaseConnection,
      ...(togglePublicConnection === undefined
        ? {}
        : { togglePublicConnection }),
      ...(lifecycleDisabledReason === undefined
        ? {}
        : {
            togglePublicConnectionDisabledReason: lifecycleDisabledReason,
          }),
      ...(lifecycleActions === undefined ? {} : { lifecycleActions }),
      quickActions: {
        ...(base.quickActions ?? {}),
        dbAccess: databaseQuickAction("dbAccess", dbAccessReason),
        metrics: databaseQuickAction("metrics"),
        logs: databaseQuickAction("logs"),
        terminal: databaseQuickAction("terminal", terminalReason),
      },
    };

    return { actions, connections };
  }, [activity, commands, id, model, type]);
}
