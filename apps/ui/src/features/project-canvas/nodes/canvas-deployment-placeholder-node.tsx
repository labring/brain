"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import type { CanvasDeploymentPlaceholderRfNode } from "./types";

export const CanvasDeploymentPlaceholderNode = memo(
  function CanvasDeploymentPlaceholderNode({
    dragging,
    isConnectable,
    selected,
  }: NodeProps<CanvasDeploymentPlaceholderRfNode>) {
    return (
      <CanvasNode.Root
        interaction={{ connectable: isConnectable, dragging, selected }}
      >
        <CanvasNode.Placeholder aria-label="Deployment placeholder" />
      </CanvasNode.Root>
    );
  }
);
