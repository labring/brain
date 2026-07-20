"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode, SyntheticEvent } from "react";

import { useCanvasNodeCopyableRow } from "./canvas-node.copyable-row";

export interface CanvasNodeCopyableRowValueProps {
  children?: ReactNode;
  className?: string;
  /** Candidate URL; the value renders as a link only when http(s). */
  href?: string;
}

/**
 * Returns the normalized href when the value is an absolute http(s) URL,
 * undefined otherwise — placeholder values like "Pending" render no link.
 */
export function canvasNodeOpenHref(
  value: string | undefined
): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") {
    return undefined;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : undefined;
  } catch {
    return undefined;
  }
}

function stopRowEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

/**
 * The value text of a copyable row. An http(s) value renders as a new-tab
 * link that underlines on hover, shows the full value in a tooltip, and
 * stays isolated from the row copy hit-area and canvas drag; other values
 * render as plain text covered by the row's copy control.
 */
export function CanvasNodeCopyableRowValue({
  children,
  className,
  href,
}: CanvasNodeCopyableRowValueProps) {
  const { copyable } = useCanvasNodeCopyableRow();
  const openHref = canvasNodeOpenHref(href);

  if (openHref === undefined) {
    return (
      <span
        aria-hidden={copyable ? true : undefined}
        className={cn("min-w-0 truncate", className)}
        data-slot="canvas-node-row-value"
      >
        {children}
      </span>
    );
  }

  const link = (
    <a
      className={cn(
        "nodrag nopan pointer-events-auto relative min-w-0 cursor-pointer truncate rounded-xs underline-offset-2 outline-none hover:underline focus-visible:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className
      )}
      data-slot="canvas-node-row-value"
      href={openHref}
      onClick={stopRowEvent}
      onDoubleClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onPointerDown={stopRowEvent}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children}
    </a>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}
