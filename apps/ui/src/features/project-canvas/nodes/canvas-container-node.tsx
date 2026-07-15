"use client";

import {
  ContainerNode,
  type ContainerNodeStates,
} from "@workspace/ui/components/container-node/container-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";
import { useProjectRuntimeNodeModel } from "@/features/project-canvas/runtime/resource-models-react";
import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import {
  containerMetricsWithTelemetrySnapshot,
  containerTelemetryTargetFromStates,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { WorkloadTelemetryTarget } from "@/features/project-canvas/telemetry/workload-telemetry-store";
import type { CanvasContainerNodeData, CanvasContainerRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";
import { useCanvasContainerNodeActions } from "./use-container-node-actions";

function CanvasContainerTelemetryMetrics({
  fallbackMetrics,
  target,
}: {
  fallbackMetrics: ContainerNodeStates["metrics"];
  target: WorkloadTelemetryTarget | null;
}) {
  const telemetry = useWorkloadTelemetrySnapshot(target);
  const metrics = containerMetricsWithTelemetrySnapshot(
    fallbackMetrics,
    telemetry
  );

  return <ContainerNode.MetricsContent metrics={metrics} />;
}

export const CanvasContainerNode = memo(function CanvasContainerNode({
  data,
  dragging,
  id,
  isConnectable,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasContainerRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasContainerNodeData>({ data, id, type }) ??
    data;
  const actions = useCanvasContainerNodeActions({ id, model, type });
  const { states } = model;
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

  return (
    <ContainerNode.Root
      defaultExpanded={expansion.defaultExpanded}
      expanded={expansion.expanded}
      interaction={{ ...interaction, connectable: isConnectable, dragging }}
      lifecycleActions={actions.lifecycleActions}
      onExpandedChange={expansion.onExpandedChange}
      quickActions={actions.quickActions}
      states={states}
    >
      <ContainerNode.Content
        metricsContent={
          <CanvasContainerTelemetryMetrics
            fallbackMetrics={states.metrics}
            target={telemetryTarget}
          />
        }
      />
    </ContainerNode.Root>
  );
});

CanvasContainerNode.displayName = "CanvasContainerNode";
