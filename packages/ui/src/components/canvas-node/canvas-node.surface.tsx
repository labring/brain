"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

export function CanvasNodeSurface({
  children,
  className,
  ...props
}: ComponentProps<"article">) {
  return (
    <article
      className={cn(
        "canvas-node-surface canvas-node-hover-surface flex min-w-0 flex-col overflow-hidden rounded-lg border-[0.5px] border-border text-zinc-50 backdrop-blur-2xl",
        className
      )}
      data-slot="canvas-node-surface"
      {...props}
    >
      {children}
    </article>
  );
}
