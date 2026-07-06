"use client";

import type {
  ContainerNodeActions,
  ContainerNodeQuickActionKey,
} from "@workspace/ui/components/container-node/container-node";
import { useMemo } from "react";
import {
  MISSING_RESOURCE_TARGET_REASON,
  resourceActionDisabledReason,
  selectionNodeFromModel,
  unavailableContainerLifecycleActions,
} from "@/features/project-canvas/nodes/node-action-availability";
import type { CanvasContainerNodeData } from "@/features/project-canvas/nodes/types";
import {
  projectApTargetFromNode,
  projectCanvasSelectionFromNode,
} from "@/features/project-canvas/surface/selection";
import { planProjectCanvasCommand } from "@/features/project-canvas/workbench/command-model";
import {
  useCanvasApLifecycleActivity,
  useProjectCanvasNodeCommands,
} from "@/features/project-canvas/workbench/node-commands-react";
import { apLifecycleWorkloadRefFromTarget } from "@/features/project-resource-actions/resource-actions";

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
    const lifecycleDisabledReason = isApKind
      ? resourceActionDisabledReason({
          authReady,
          readOnly,
          targetAvailable: workload != null,
        })
      : undefined;
    const lifecycleWorkload =
      isApKind && lifecycleDisabledReason === undefined ? workload : null;
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

    const ref = lifecycleWorkload ?? { name: states.name, namespace: ns };
    const displayName = states.name;
    const lifecycleActions =
      lifecycleWorkload == null
        ? unavailableContainerLifecycleActions(lifecycleDisabledReason)
        : {
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
                commands.runResourceAction(
                  () => commands.startApWorkload(ref),
                  {
                    loading: `Starting "${displayName}"...`,
                    success: `Started "${displayName}"`,
                  }
                ),
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
          };
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
