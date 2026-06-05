"use client";

import { useCanvas } from "@workspace/ui/components/canvas/canvas.use";
import { DatabaseNode } from "@workspace/ui/components/database-node/database-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";

import {
  databaseStatesWithTelemetry,
  databaseTelemetryTargetFromWorkload,
  shouldSubscribeWorkloadTelemetry,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import type { CanvasDatabaseRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasDatabaseNode = memo(function CanvasDatabaseNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasDatabaseRfNode>) {
  const { actions = {}, connections, states } = data;
  const telemetryTarget = useMemo(
    () => databaseTelemetryTargetFromWorkload(data.workload),
    [data.workload]
  );
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
  const activeTelemetryTarget = shouldSubscribeWorkloadTelemetry({
    expanded: expansion.expanded,
    selected,
    sidePaneOpen: false,
  })
    ? telemetryTarget
    : null;
  const telemetry = useWorkloadTelemetrySnapshot(activeTelemetryTarget);
  const statesWithTelemetry = databaseStatesWithTelemetry(states, telemetry);

  return (
    <DatabaseNode.Root
      connections={connections}
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ dragging, highlightedConnectionSide, selected }}
      lifecycleActions={actions.lifecycleActions}
      onCopyConnection={actions.copyConnection}
      onExpandedChange={expansion.onExpandedChange}
      onTogglePublicConnection={actions.togglePublicConnection}
      quickActions={actions.quickActions}
      states={statesWithTelemetry}
    >
      <DatabaseNode.Content />
    </DatabaseNode.Root>
  );
});

CanvasDatabaseNode.displayName = "CanvasDatabaseNode";
