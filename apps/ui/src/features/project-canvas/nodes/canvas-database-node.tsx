"use client";

import { DatabaseNode } from "@workspace/ui/components/database-node/database-node";
import type { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";

import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import {
  databaseStatesWithTelemetry,
  databaseTelemetryTargetFromWorkload,
  shouldSubscribeWorkloadTelemetry,
} from "@/features/project-canvas/telemetry/workload-telemetry-node";
import { useWorkloadTelemetrySnapshot } from "@/features/project-canvas/telemetry/workload-telemetry-react";
import { useProjectRuntimeNodeModel } from "@/features/project-runtime/resource-models-react";
import type { CanvasDatabaseNodeData, CanvasDatabaseRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasDatabaseNode = memo(function CanvasDatabaseNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasDatabaseRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasDatabaseNodeData>(data) ?? data;
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
  const activeTelemetryTarget = shouldSubscribeWorkloadTelemetry({
    expanded: expansion.expanded,
    selected: interaction.selected,
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
      interaction={{ ...interaction, dragging }}
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
