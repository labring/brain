"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { ExternalLink, Router } from "lucide-react";
import type { SyntheticEvent } from "react";

import { useEntryNode } from "./entry-node.context";
import { EntryNodeGroupList } from "./entry-node.group";
import {
  entryNodeAddresses,
  resolveEntryNodeGroupsStatus,
} from "./entry-node.status";
import type { EntryNodeOpenTarget } from "./entry-node.types";

export const ENTRY_NODE_LABEL = "Public access";
export const ENTRY_NODE_OPEN_LABEL = "Open";
export const ENTRY_NODE_OPEN_NOT_ACCESSIBLE_REASON = "Not accessible yet";
export const ENTRY_NODE_OPEN_NOT_CONFIGURED_REASON = "Not configured";

export function entryNodeAddressCountLabel(count: number): string {
  return count === 1 ? "1 address" : `${count} addresses`;
}

/**
 * Why the Open control is disabled, or undefined when it opens `open.url`.
 * No target at all means the AP has no Public Address; a target without a
 * URL means none of the Default Open Port's addresses is accessible yet.
 */
export function entryNodeOpenDisabledReason(
  open: EntryNodeOpenTarget | undefined
): string | undefined {
  if (open === undefined) {
    return ENTRY_NODE_OPEN_NOT_CONFIGURED_REASON;
  }
  if (open.url === undefined || open.url.trim() === "") {
    return open.disabledReason ?? ENTRY_NODE_OPEN_NOT_ACCESSIBLE_REASON;
  }
  return undefined;
}

function useEntryNodeResolvedStatus() {
  const {
    state: { groups },
  } = useEntryNode();

  return resolveEntryNodeGroupsStatus(groups);
}

function stopNodeEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

export function EntryNodeContent() {
  return (
    <CanvasNode.Card>
      <CanvasNode.Header>
        <EntryNodeHeaderContent />
      </CanvasNode.Header>
      <CanvasNode.Body>
        <EntryNodeGroupList />
      </CanvasNode.Body>
    </CanvasNode.Card>
  );
}

/**
 * Header: label + address count on the left, the Open control on the right.
 * No per-address health is aggregated here (CONTEXT.md, AP Public Access
 * Node); the rows carry their own status dots.
 */
export function EntryNodeHeaderContent({ className }: { className?: string }) {
  return (
    <div className={cn("canvas-node-header-content min-w-0 flex-1", className)}>
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <EntryNodeAccess />
        <EntryNodeOpen />
      </div>
    </div>
  );
}

export function EntryNodeAccess({ className }: { className?: string }) {
  const {
    state: { groups },
  } = useEntryNode();
  const addressCount = entryNodeAddresses(groups).length;
  const Icon = Router;

  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
        <Icon aria-hidden className="size-4 text-zinc-50" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="min-w-0 truncate font-normal text-sm text-zinc-50 leading-5">
          {ENTRY_NODE_LABEL}
        </span>
        <span
          className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4"
          data-slot="entry-node-address-count"
        >
          {entryNodeAddressCountLabel(addressCount)}
        </span>
      </span>
    </span>
  );
}

/**
 * The one Open control of the node: an anchor-backed icon button that opens
 * the Default Open Port's best Public Address in a new tab. Without a URL it
 * stays visible but disabled, and its tooltip carries the reason. Visible in
 * the collapsed node too, so the card is always one click from the app.
 */
export function EntryNodeOpen({ className }: { className?: string }) {
  const {
    state: { open },
  } = useEntryNode();
  const label = open?.label ?? ENTRY_NODE_OPEN_LABEL;
  const disabledReason = entryNodeOpenDisabledReason(open);
  const url = disabledReason === undefined ? open?.url : undefined;
  const button = (
    <AppIconButton
      aria-description={disabledReason}
      aria-disabled={disabledReason === undefined ? undefined : true}
      aria-label={label}
      className={cn(
        "nodrag nopan shrink-0 cursor-pointer border-0",
        disabledReason !== undefined &&
          "cursor-not-allowed opacity-50 hover:text-brand-primary-foreground",
        className
      )}
      data-slot="entry-node-open"
      nativeButton={url === undefined ? undefined : false}
      onClick={stopNodeEvent}
      onDoubleClick={stopNodeEvent}
      onKeyDown={stopNodeEvent}
      onPointerDown={stopNodeEvent}
      render={
        url === undefined ? undefined : (
          // biome-ignore lint/a11y/useAnchorContent: Base UI merges the button children into the anchor
          <a href={url} rel="noopener noreferrer" target="_blank" />
        )
      }
      size="md"
      type="button"
      variant="node"
    >
      <ExternalLink aria-hidden className="size-4" />
    </AppIconButton>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{disabledReason ?? label}</TooltipContent>
    </Tooltip>
  );
}

/** Aggregate health pill. No longer part of the header; kept for callers. */
export function EntryNodeStatus({ className }: { className?: string }) {
  const status = useEntryNodeResolvedStatus();

  return <CanvasNode.Status className={className} status={status} />;
}
