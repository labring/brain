"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import type { NodeProps } from "@xyflow/react";
import type { CanvasDeploymentPlaceholderRfNode } from "./types";

export function CanvasDeploymentPlaceholderNode({
  selected,
}: NodeProps<CanvasDeploymentPlaceholderRfNode>) {
  return (
    <div
      aria-label="Deployment placeholder"
      className={[
        "w-[272px] rounded-lg border border-border bg-card/85 p-3 shadow-sm",
        selected ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-slot="deployment-placeholder-node"
      role="status"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3 w-32 max-w-full" />
          <Skeleton className="h-2.5 w-44 max-w-full" />
        </div>
      </div>
    </div>
  );
}
