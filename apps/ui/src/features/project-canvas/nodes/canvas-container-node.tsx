"use client";

import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";

import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import {
  containerStatesWithTelemetry,
  containerTelemetryTargetFromStates,
  shouldSubscribeWorkloadTelemetry,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import { useProjectRuntimeNodeModel } from "@/features/project-runtime/resource-models-react";
import type { CanvasContainerNodeData, CanvasContainerRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasContainerNode = memo(function CanvasContainerNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasContainerRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasContainerNodeData>({ data, id, type }) ??
    data;
  const { actions = {}, states } = model;
  const { name, namespace } = states;
  const telemetryTarget = useMemo(
    () =>
      model.resourceKind === "template"
        ? null
        : containerTelemetryTargetFromStates({ name, namespace }),
    [model.resourceKind, name, namespace]
  );
  const interaction = useProjectCanvasNodeInteraction(id);
  const expansion = useCanvasNodeExpansion({
    data,
    id,
    positionAbsoluteX,
    positionAbsoluteY,
    type,
  });
  const activeTelemetryTarget = shouldSubscribeWorkloadTelemetry({
    expanded: expansion.expanded,
    selected: interaction.selected,
    sidePaneOpen: false,
  })
    ? telemetryTarget
    : null;
  const telemetry = useWorkloadTelemetrySnapshot(activeTelemetryTarget);
  const statesWithTelemetry = containerStatesWithTelemetry(states, telemetry);

  return (
    <ContainerNode.Root
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ ...interaction, dragging }}
      lifecycleActions={actions.lifecycleActions}
      onExpandedChange={expansion.onExpandedChange}
      quickActions={actions.quickActions}
      states={statesWithTelemetry}
    >
      <ContainerNode.Content />
    </ContainerNode.Root>
  );
});

CanvasContainerNode.displayName = "CanvasContainerNode";
