"use client";

import {
  DatabaseNode,
  type DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";
import { useProjectRuntimeNodeModel } from "@/features/project-canvas/runtime/resource-models-react";
import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import {
  databaseMetricsWithTelemetrySnapshot,
  databaseTelemetryTargetFromWorkload,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { WorkloadTelemetryTarget } from "@/features/project-canvas/telemetry/workload-telemetry-store";
import { shouldShowDatabaseDeletionDelayHint } from "./database-deletion-warning";
import type { CanvasDatabaseNodeData, CanvasDatabaseRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";
import { useCanvasDatabaseNodeActions } from "./use-database-node-actions";

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
  const { actions, connections } = useCanvasDatabaseNodeActions({
    id,
    model,
    type,
  });
  const { states } = model;
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
  const showDeletionDelayHint = shouldShowDatabaseDeletionDelayHint({
    nowMs: Date.now(),
    states,
  });

  return (
    <DatabaseNode.Root
      connections={connections}
      defaultExpanded={expansion.defaultExpanded}
      expanded={expansion.expanded}
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
      <div className="relative">
        <DatabaseNode.Content
          metricsContent={
            <CanvasDatabaseTelemetryMetrics
              fallbackMetrics={states.metrics}
              target={telemetryTarget}
            />
          }
        />
        {showDeletionDelayHint ? (
          <DatabaseNode.DeletionDelayHint className="absolute top-full left-1/2 mt-2 -translate-x-1/2" />
        ) : null}
      </div>
    </DatabaseNode.Root>
  );
});

CanvasDatabaseNode.displayName = "CanvasDatabaseNode";
