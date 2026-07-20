"use client";

import {
  AppIconButton,
  appIconButtonVariants,
} from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { Check, Copy, ExternalLink } from "lucide-react";

import {
  CanvasNodeCopyableRowControl,
  useCanvasNodeCopyableRow,
} from "./canvas-node.copyable-row";

export interface CanvasNodeCopyableRowActionsProps {
  className?: string;
  /** Row subject used in control labels, e.g. "Platform Address". */
  label: string;
  /** Candidate URL for the open link; the link renders only when http(s). */
  openHref?: string;
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

/**
 * The value-action cluster for a copyable row: an open-in-new-tab link plus
 * an explicit copy button routed through the row's copy pipeline. Controls
 * surface on row hover/focus and stay pinned during copied feedback.
 */
export function CanvasNodeCopyableRowActions({
  className,
  label,
  openHref,
}: CanvasNodeCopyableRowActionsProps) {
  const { copied, copyable, copyRow } = useCanvasNodeCopyableRow();
  const href = canvasNodeOpenHref(openHref);

  if (href === undefined && !copyable) {
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
      {href === undefined ? null : (
        <a
          aria-label={`Open ${label}`}
          className={cn(
            appIconButtonVariants({ size: "sm", variant: "quiet" }),
            "inline-flex cursor-pointer items-center justify-center text-muted-foreground outline-none hover:text-foreground"
          )}
          data-slot="canvas-node-row-open-link"
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink aria-hidden className="size-4" />
        </a>
      )}
      {copyable ? (
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
      ) : null}
    </CanvasNodeCopyableRowControl>
  );
}
