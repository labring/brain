"use client";

import { WorkspaceAvatar } from "@workspace/ui/components/workspace-avatar";
import { cn } from "@workspace/ui/lib/utils";
import { Plus } from "lucide-react";
import Link from "next/link";

import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import type { SessionWorkspace } from "@/features/session/session-schema";

import { workspaceAreaPath } from "./workspace-area-route-core";

const ROW_CLASS =
  "flex h-9 shrink-0 items-center gap-2 rounded-md p-2 text-left text-sm leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 lg:w-full";

function roleLabel(workspace: SessionWorkspace): string {
  return workspace.isPersonal ? "Personal" : workspace.role;
}

/**
 * The Workspace Area's list (spec §D.3): every Workspace the user belongs
 * to, in Desktop's order, one row each — square avatar, name, a blue dot on
 * the current Workspace, the user's role (or "Personal") — then a divider
 * and the Create Workspace row into the Billing Area's creation mode.
 * Choosing a row names the Managed Workspace in the URL and never switches
 * the current Workspace.
 */
export function WorkspaceAreaList({
  currentUid,
  managedUid,
  workspaces,
}: {
  currentUid: string | null;
  managedUid: string | null;
  workspaces: readonly SessionWorkspace[];
}) {
  return (
    <nav
      aria-label="Workspaces"
      className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:overflow-visible"
      data-slot="workspace-area-list"
    >
      {workspaces.map((workspace) => {
        const selected = workspace.uid === managedUid;
        return (
          <Link
            aria-current={selected ? "page" : undefined}
            className={cn(
              ROW_CLASS,
              selected
                ? "bg-input font-medium text-foreground"
                : "text-foreground hover:bg-input/30"
            )}
            data-slot="workspace-area-row"
            href={workspaceAreaPath(workspace.uid)}
            key={workspace.uid}
          >
            <WorkspaceAvatar
              className="size-4 rounded-sm"
              square
              workspaceId={workspace.id}
            />
            <span className="min-w-0 max-w-40 flex-1 truncate lg:max-w-none">
              {workspace.name}
            </span>
            {workspace.uid === currentUid ? (
              <span
                aria-label="Current workspace"
                className="size-1.5 shrink-0 rounded-full bg-blue-400"
                data-slot="workspace-area-current-dot"
                role="img"
              />
            ) : null}
            <span className="shrink-0 font-normal text-muted-foreground text-xs">
              {roleLabel(workspace)}
            </span>
          </Link>
        );
      })}
      <div aria-hidden className="my-1 hidden h-px bg-border lg:block" />
      <Link
        className={cn(
          ROW_CLASS,
          "bg-input/30 font-medium text-primary hover:bg-input/50"
        )}
        data-slot="workspace-area-create"
        href="/billing?mode=create"
        onClick={recordBillingReturnRoute}
      >
        <Plus aria-hidden className="size-4" />
        Create Workspace
      </Link>
    </nav>
  );
}
