"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

import { Skeleton } from "../skeleton";
import { CanvasNodeConnectionAnchor } from "./canvas-node.connection";
import { CanvasNodeDragStateFrame } from "./canvas-node.drag-frame";
import { CanvasNodeFrame } from "./canvas-node.frame";
import { CanvasNodeSurface } from "./canvas-node.surface";

export interface CanvasNodePlaceholderProps
  extends Omit<ComponentProps<"article">, "children" | "className"> {
  children?: ReactNode;
  className?: string;
  "data-slot"?: never;
  surfaceClassName?: string;
}

export function CanvasNodePlaceholder({
  children,
  className,
  role = "status",
  surfaceClassName,
  ...props
}: CanvasNodePlaceholderProps) {
  const { "data-slot": _dataSlot, ...surfaceProps } = props;

  return (
    <CanvasNodeFrame className={className}>
      <CanvasNodeConnectionAnchor />
      <CanvasNodeDragStateFrame>
        <CanvasNodeSurface
          className={cn("justify-center p-3", surfaceClassName)}
          role={role}
          {...surfaceProps}
        >
          {children ?? <CanvasNodePlaceholderSkeleton />}
        </CanvasNodeSurface>
      </CanvasNodeDragStateFrame>
    </CanvasNodeFrame>
  );
}

function CanvasNodePlaceholderSkeleton() {
  return (
    <div
      className="flex items-center gap-3"
      data-slot="canvas-node-placeholder"
    >
      <Skeleton className="size-9 shrink-0 rounded-md bg-input" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-3 w-32 max-w-full bg-input" />
        <Skeleton className="h-2.5 w-44 max-w-full bg-input" />
      </div>
    </div>
  );
}
