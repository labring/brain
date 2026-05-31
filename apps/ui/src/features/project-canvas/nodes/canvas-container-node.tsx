"use client";

import { useCanvas } from "@workspace/ui/components/canvas/canvas.use";
import { ContainerNode } from "@workspace/ui/components/container-node/container-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";

import {
  containerStatesWithTelemetry,
  containerTelemetryTargetFromStates,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { CanvasContainerRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasContainerNode = memo(function CanvasContainerNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasContainerRfNode>) {
  const { actions = {}, states } = data;
  const { name, namespace } = states;
  const telemetryTarget = useMemo(
    () => containerTelemetryTargetFromStates({ name, namespace }),
    [name, namespace]
  );
  const telemetry = useWorkloadTelemetrySnapshot(telemetryTarget);
  const statesWithTelemetry = containerStatesWithTelemetry(states, telemetry);
  const { state } = useCanvas();
  const edge = state.selectedEdge;
  const isEndpointOfSelectedEdge =
    edge != null && (edge.source === id || edge.target === id);
  const selected =
    (state.selectedNode != null && state.selectedNode.id === id) ||
    isEndpointOfSelectedEdge;
  const highlightedConnectionSide =
    state.connectionOrigin?.nodeId === id
      ? state.connectionOrigin.side
      : undefined;
  const expansion = useCanvasNodeExpansion({
    data,
    id,
    positionAbsoluteX,
    positionAbsoluteY,
    type,
  });

  return (
    <ContainerNode.Root
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ dragging, highlightedConnectionSide, selected }}
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
