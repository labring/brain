"use client";

import { useCanvas } from "@workspace/ui/components/canvas/canvas.use";
import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { CanvasEntryRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasEntryNode = memo(function CanvasEntryNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasEntryRfNode>) {
  const { accessDomain, actions = {}, states, targets } = data;
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
    <EntryNode.Root
      accessDomain={accessDomain}
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ dragging, highlightedConnectionSide, selected }}
      onCopyTarget={actions.copyTarget}
      onExpandedChange={expansion.onExpandedChange}
      states={states}
      targets={targets}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
});

CanvasEntryNode.displayName = "CanvasEntryNode";
