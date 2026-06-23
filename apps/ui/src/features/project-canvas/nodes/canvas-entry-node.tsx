"use client";

import { EntryNode } from "@workspace/ui/components/entry-node/entry-node";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";

import { useProjectCanvasNodeInteraction } from "@/features/project-canvas/surface/interaction-react";
import { useProjectRuntimeNodeModel } from "@/features/project-runtime/resource-models-react";
import type { CanvasEntryNodeData, CanvasEntryRfNode } from "./types";
import { useCanvasNodeExpansion } from "./use-canvas-node-expansion";

export const CanvasEntryNode = memo(function CanvasEntryNode({
  data,
  dragging,
  id,
  positionAbsoluteX,
  positionAbsoluteY,
  type,
}: NodeProps<CanvasEntryRfNode>) {
  const model =
    useProjectRuntimeNodeModel<CanvasEntryNodeData>({ data, id, type }) ?? data;
  const { accessDomain, actions = {}, states, targets } = model;
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
      accessDomain={accessDomain}
      defaultExpanded={expansion.defaultExpanded}
      interaction={{ ...interaction, dragging }}
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
