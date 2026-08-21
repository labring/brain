"use client";

import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { cn } from "@workspace/ui/lib/utils";
import { Router } from "lucide-react";

import { useEntryNode } from "./entry-node.context";
import { resolveEntryNodeTargetStatus } from "./entry-node.status";
import { EntryNodeTargetList } from "./entry-node.target";
import type { EntryNodeAccessDomain } from "./entry-node.types";

function getAccessDomain(
  fallbackName: string,
  accessDomain: EntryNodeAccessDomain | undefined
) {
  return (
    accessDomain ?? {
      label: "Access domain",
      value: fallbackName,
    }
  );
}

function useEntryNodeAccessDomain() {
  const {
    state: { accessDomain, states },
  } = useEntryNode();

  return getAccessDomain(states.displayName ?? states.name, accessDomain);
}

function useEntryNodeResolvedStatus() {
  const {
    state: { targets },
  } = useEntryNode();

  return resolveEntryNodeTargetStatus(targets);
}

export function EntryNodeContent() {
  return (
    <CanvasNode.Card>
      <CanvasNode.Header>
        <EntryNodeHeaderContent />
      </CanvasNode.Header>
      <CanvasNode.Body>
        <EntryNodeTargetList />
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
  const accessDomain = useEntryNodeAccessDomain();
  const Icon = Router;

  return (
    <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
        <Icon aria-hidden className="size-4 text-zinc-50" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span
          className="min-w-0 truncate font-normal text-sm text-zinc-50 leading-5"
          title={accessDomain.value}
        >
          {accessDomain.value}
        </span>
        <span className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4">
          {accessDomain.label ?? "Access domain"}
        </span>
      </span>
    </span>
  );
}

export function EntryNodeStatus({ className }: { className?: string }) {
  const status = useEntryNodeResolvedStatus();

  return <CanvasNode.Status className={className} status={status} />;
}
