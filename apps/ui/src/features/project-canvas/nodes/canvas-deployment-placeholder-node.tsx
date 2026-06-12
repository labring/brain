"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import type { NodeProps } from "@xyflow/react";
import type { CanvasDeploymentPlaceholderRfNode } from "./types";

export function CanvasDeploymentPlaceholderNode({
  dragging,
  selected,
}: NodeProps<CanvasDeploymentPlaceholderRfNode>) {
  return (
    <CanvasNode.Root interaction={{ dragging, selected }}>
      <CanvasNode.Placeholder aria-label="Deployment placeholder" />
    </CanvasNode.Root>
  );
}
