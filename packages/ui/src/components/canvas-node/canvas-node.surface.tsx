"use client";

import { cn } from "@workspace/ui/lib/utils";
import { useNodeId } from "@xyflow/react";
import type { ComponentProps } from "react";
import { useCanvasNodeSelfBlur } from "../canvas/canvas-glass-context";

export function CanvasNodeSurface({
  children,
  className,
  ...props
}: ComponentProps<"article">) {
  // When the shared glass sheet handles this node, drop the per-node blur; keep
  // it when there's no sheet or the node overlaps another.
  const selfBlur = useCanvasNodeSelfBlur(useNodeId());
  return (
    <article
      className={cn(
        "canvas-node-surface canvas-node-hover-surface flex min-w-0 flex-col overflow-hidden rounded-lg border-[0.5px] border-border text-zinc-50",
        className
      )}
      data-self-blur={selfBlur ? "" : undefined}
      data-slot="canvas-node-surface"
      {...props}
    >
      {children}
    </article>
  );
}
