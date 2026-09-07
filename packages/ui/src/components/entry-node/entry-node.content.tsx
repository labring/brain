"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { cn } from "@workspace/ui/lib/utils";
import { Router } from "lucide-react";

import { useEntryNode } from "./entry-node.context";
import { EntryNodeGroupList } from "./entry-node.group";
import {
  entryNodeAddresses,
  resolveEntryNodeGroupsStatus,
} from "./entry-node.status";

export const ENTRY_NODE_LABEL = "Public access";

export function entryNodeAddressCountLabel(count: number): string {
  if (count === 0) {
    return "No addresses";
  }
  return count === 1 ? "1 address" : `${count} addresses`;
}

function useEntryNodeResolvedStatus() {
  const {
    state: { groups },
  } = useEntryNode();

  return resolveEntryNodeGroupsStatus(groups);
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

export function EntryNodeHeaderContent({ className }: { className?: string }) {
  return (
    <div className={cn("canvas-node-header-content min-w-0 flex-1", className)}>
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <EntryNodeAccess />
        <EntryNodeStatus />
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

export function EntryNodeStatus({ className }: { className?: string }) {
  const status = useEntryNodeResolvedStatus();

  return <CanvasNode.Status className={className} status={status} />;
}
