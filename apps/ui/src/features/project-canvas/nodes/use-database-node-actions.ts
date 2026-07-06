"use client";

import type {
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeQuickActionKey,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import { useMemo } from "react";
import { resolveDatabasePublicConnections } from "@/features/project-canvas/flow/database-public-connection";
import {
  databaseLiveSessionUnavailableReasons,
  MISSING_RESOURCE_TARGET_REASON,
  resourceActionDisabledReason,
  selectionNodeFromModel,
  unavailableDatabaseLifecycleActions,
} from "@/features/project-canvas/nodes/node-action-availability";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import {
  projectCanvasSelectionFromNode,
  projectDbTargetFromNode,
} from "@/features/project-canvas/surface/selection";
import { planProjectCanvasCommand } from "@/features/project-canvas/workbench/command-model";
import {
  useCanvasDbLifecycleActivity,
  useProjectCanvasNodeCommands,
} from "@/features/project-canvas/workbench/node-commands-react";
import { dbLifecycleWorkloadRefFromTarget } from "@/features/project-resource-actions/resource-actions";

export interface CanvasDatabaseNodeViewModel {
  actions: DatabaseNodeActions;
  connections: DatabaseNodeConnection[];
}

/**
 * Builds database node actions and pending-aware connections from the stable
 * canvas command surface plus this node's lifecycle activity. Mutation
 * availability (lifecycle and public-access toggling) derives from one
 * disabled-reason source: handlers are only attached when that reason is
 * undefined, so the node UI never receives an enabled control alongside a
 * disabled reason.
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
    const mutationDisabledReason = resourceActionDisabledReason({
      authReady: activity.authReady,
      readOnly,
      targetAvailable: workload != null,
    });
    const mutableWorkload =
      mutationDisabledReason === undefined ? workload : null;
    const connections = resolveDatabasePublicConnections(
      model.connections,
      activity.publicAccessPendingTarget
    );
    const togglePublicConnection:
      | DatabaseNodeTogglePublicConnectionHandler
      | undefined =
      mutableWorkload == null
        ? undefined
        : (_connection, _index, nextEnabled) => {
            commands.runResourceAction(
              () =>
                commands.toggleDatabasePublicAccess({
                  metadata: model.metadata,
                  nextEnabled,
                  workload: mutableWorkload,
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
                  commands.clearDbPublicAccessPendingTarget(mutableWorkload),
              }
            );
          };
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
      mutableWorkload == null
        ? unavailableDatabaseLifecycleActions(mutationDisabledReason)
        : {
            delete: {
              loading: activity.loadingDelete,
              onClick: () =>
                commands.requestDbDelete({
                  displayName,
                  name: mutableWorkload.name,
                  namespace: mutableWorkload.namespace,
                }),
            },
            restart: dbLifecycleAction(
              activity.loadingRestart,
              () => commands.restartDbWorkload(mutableWorkload),
              {
                loading: `Restarting "${displayName}"...`,
                success: `Restart requested for "${displayName}"`,
              }
            ),
            start: dbLifecycleAction(
              activity.loadingStart,
              () => commands.startDbWorkload(mutableWorkload),
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
                  name: mutableWorkload.name,
                  namespace: mutableWorkload.namespace,
                }),
            },
          };

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
      ...(mutationDisabledReason === undefined
        ? {}
        : {
            togglePublicConnectionDisabledReason: mutationDisabledReason,
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
