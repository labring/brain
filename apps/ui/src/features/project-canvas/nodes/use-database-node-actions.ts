"use client";

import type {
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeQuickActionKey,
  DatabaseNodeRevealConnectionHandler,
  DatabaseNodeRevealedConnection,
  DatabaseNodeTogglePublicConnectionHandler,
} from "@workspace/ui/components/database-node/database-node";
import { getDatabaseNodeConnectionKey } from "@workspace/ui/components/database-node/database-node";
import { useMemo } from "react";
import { dbLifecycleWorkloadRefFromTarget } from "@/features/project-canvas/actions/resource-actions";
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
import { useRevealedRow } from "@/features/resource-settings/use-revealed-row";

export interface CanvasDatabaseNodeViewModel {
  actions: DatabaseNodeActions;
  connections: DatabaseNodeConnection[];
  revealedConnection: DatabaseNodeRevealedConnection | null;
}

// The eye swaps the on-demand DSN into one row at a time (ADR-0054); the
// handler is omitted when no resolver backs the canvas, which hides the eye.
function databaseNodeRevealActions({
  commands,
  revealAvailable,
  toggleRevealedRow,
  workload,
}: {
  commands: NonNullable<ReturnType<typeof useProjectCanvasNodeCommands>>;
  revealAvailable: boolean;
  toggleRevealedRow: ReturnType<typeof useRevealedRow>["toggleRevealedRow"];
  workload: { name: string; namespace: string } | null;
}): Pick<DatabaseNodeActions, "revealConnection"> {
  if (workload == null || !revealAvailable) {
    return {};
  }
  const revealConnection: DatabaseNodeRevealConnectionHandler = (
    connection,
    index
  ) =>
    toggleRevealedRow(getDatabaseNodeConnectionKey(connection, index), () =>
      commands.resolveDatabaseConnectionString(connection, workload)
    );
  return { revealConnection };
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
  const { revealedRow, toggleRevealedRow } = useRevealedRow();

  const viewModel = useMemo(() => {
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
            restart: {
              loading: activity.loadingRestart,
              onClick: () =>
                commands.requestDbRestart({
                  displayName,
                  name: mutableWorkload.name,
                  namespace: mutableWorkload.namespace,
                }),
            },
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
      // Copy fetches the complete DB Connection DSN on demand (ADR-0052);
      // the node's connection rows only ever hold the template.
      copyConnection: (connection) =>
        commands.copyDatabaseConnection(connection, workload),
      ...databaseNodeRevealActions({
        commands,
        revealAvailable: activity.authReady && !readOnly,
        toggleRevealedRow,
        workload,
      }),
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
  }, [activity, commands, id, model, toggleRevealedRow, type]);

  return { ...viewModel, revealedConnection: revealedRow };
}
