"use client";

import {
  DatabaseNode,
  type DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";

import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import {
  databaseMetricsWithTelemetrySnapshot,
  databaseTelemetryTargetFromWorkload,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { WorkloadTelemetryTarget } from "@/features/project-canvas/telemetry/workload-telemetry-store";
import { useProjectRuntimeNodeModel } from "@/features/project-runtime/resource-models-react";
import type { CanvasDatabaseNodeData, CanvasDatabaseRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

function CanvasDatabaseTelemetryMetrics({
  fallbackMetrics,
  target,
}: {
  fallbackMetrics: DatabaseNodeStates["metrics"];
  target: WorkloadTelemetryTarget | null;
}) {
  const telemetry = useWorkloadTelemetrySnapshot(target);
  const metrics = databaseMetricsWithTelemetrySnapshot(
    fallbackMetrics,
    telemetry
  );

  return <DatabaseNode.MetricsContent metrics={metrics} />;
}

export const CanvasDatabaseNode = memo(function CanvasDatabaseNode({
  data,
  dragging,
  id,
  isConnectable,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasDatabaseRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasDatabaseNodeData>({ data, id, type }) ??
    data;
  const { actions = {}, connections, states } = model;
  const telemetryTarget = useMemo(
    () => databaseTelemetryTargetFromWorkload(model.workload),
    [model.workload]
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
    <DatabaseNode.Root
      connections={connections}
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ ...interaction, connectable: isConnectable, dragging }}
      lifecycleActions={actions.lifecycleActions}
      onCopyConnection={actions.copyConnection}
      onExpandedChange={expansion.onExpandedChange}
      onTogglePublicConnection={actions.togglePublicConnection}
      quickActions={actions.quickActions}
      states={states}
      togglePublicConnectionDisabledReason={
        actions.togglePublicConnectionDisabledReason
      }
    >
      <DatabaseNode.Content
        metricsContent={
          <CanvasDatabaseTelemetryMetrics
            fallbackMetrics={states.metrics}
            target={telemetryTarget}
          />
        }
      />
    </DatabaseNode.Root>
  );
});

CanvasDatabaseNode.displayName = "CanvasDatabaseNode";
