"use client";

import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useProjectRuntimeNodeModel } from "@/features/project-canvas/runtime/resource-models-react";
import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import type { CanvasEntryNodeData, CanvasEntryRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasEntryNode = memo(function CanvasEntryNode({
  data,
  dragging,
  id,
  isConnectable,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasEntryRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasEntryNodeData>({ data, id, type }) ?? data;
  const { actions = {}, groups, open, states } = model;
  const interaction = useProjectCanvasNodeInteraction(id);
  const expansion = useCanvasNodeExpansion({
    data,
    id,
    positionAbsoluteX,
    positionAbsoluteY,
    type,
  });

  return (
    <EntryNode.Root
      defaultExpanded={expansion.defaultExpanded}
      expanded={expansion.expanded}
      groups={groups}
      interaction={{ ...interaction, connectable: isConnectable, dragging }}
      onCopyAddress={actions.copyAddress}
      onExpandedChange={expansion.onExpandedChange}
      open={open}
      states={states}
    >
      <EntryNode.Content />
    </EntryNode.Root>
  );
});

CanvasEntryNode.displayName = "CanvasEntryNode";
