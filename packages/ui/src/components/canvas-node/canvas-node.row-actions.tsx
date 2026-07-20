"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy } from "lucide-react";

import {
  CanvasNodeCopyableRowControl,
  useCanvasNodeCopyableRow,
} from "./canvas-node.copyable-row";

export interface CanvasNodeCopyableRowActionsProps {
  className?: string;
  /** Row subject used in control labels, e.g. "Platform Address". */
  label: string;
}

/**
 * The action cluster for a copyable row: an explicit copy button routed
 * through the row's copy pipeline. Controls surface on row hover/focus and
 * stay pinned during copied feedback.
 */
export function CanvasNodeCopyableRowActions({
  className,
  label,
}: CanvasNodeCopyableRowActionsProps) {
  const { copied, copyable, copyRow } = useCanvasNodeCopyableRow();

  if (!copyable) {
    return null;
  }

  return (
    <CanvasNodeCopyableRowControl
      className={cn(
        "pointer-events-auto relative z-20 -mr-1.5 flex shrink-0 items-center gap-0.5 transition-opacity",
        copied
          ? "opacity-100"
          : "opacity-0 group-focus-within/copyable-row:opacity-100 group-hover/copyable-row:opacity-100",
        className
      )}
      data-slot="canvas-node-row-actions"
    >
      <AppIconButton
        aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          copied && "text-foreground"
        )}
        data-slot="canvas-node-row-copy-button"
        onClick={() => {
          copyRow().catch(() => undefined);
        }}
        size="sm"
        type="button"
        variant="quiet"
      >
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
      </AppIconButton>
    </CanvasNodeCopyableRowControl>
  );
}
