"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { Badge } from "@workspace/ui/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { WorkspaceAvatar } from "@workspace/ui/components/workspace-avatar";
import {
  ArrowLeftRight,
  Copy,
  LogOut,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import type { SessionWorkspace } from "@/features/session/session-schema";

import type { WorkspaceActions } from "./use-workspace-actions";
import {
  WorkspaceDeleteDialog,
  WorkspaceLeaveDialog,
  WorkspaceRenameDialog,
  WorkspaceTransferDialog,
} from "./workspace-detail-dialogs";
import type { WorkspaceMember } from "./workspace-details-schema";
import type {
  WorkspaceActionGate,
  WorkspaceActionGates,
} from "./workspace-gating-core";
import { PlanSlot } from "./workspace-plan-slot";

type HeaderDialog = "delete" | "leave" | "rename" | "transfer";

export const WORKSPACE_ID_COPIED_NOTICE = "Workspace ID copied";

function copyWorkspaceId(id: string): void {
  if (typeof navigator === "undefined" || navigator.clipboard == null) {
    return;
  }
  navigator.clipboard
    .writeText(id)
    .then(() => toast(WORKSPACE_ID_COPIED_NOTICE))
    .catch(() => undefined);
}

/** A disabled control explained by a tooltip (a state gate). */
function WithReason({
  children,
  reason,
}: {
  children: ReactNode;
  reason: string | null;
}) {
  if (reason == null) {
    return children;
  }
  return (
    <Tooltip>
      {/* A disabled button fires no pointer events; the span carries them. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

function disabledReason(gate: WorkspaceActionGate): string | null {
  return gate.kind === "disabled" ? gate.reason : null;
}

/** A menu row whose second line, when present, says why it is disabled. */
function MenuAction({
  gate,
  icon,
  label,
  onSelect,
  variant,
}: {
  gate: WorkspaceActionGate;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  variant?: "default" | "destructive";
}) {
  const reason = disabledReason(gate);
  return (
    <DropdownMenuItem
      disabled={reason != null}
      onClick={onSelect}
      variant={variant}
    >
      {icon}
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {reason == null ? null : (
          <span
            className="text-muted-foreground text-xs"
            data-slot="workspace-action-reason"
          >
            {reason}
          </span>
        )}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The Owner's ⋯ menu (spec §D.4): Rename for every Owner; for a Team
 * Workspace a divider, Transfer ownership, and Delete workspace, each
 * disabled with its reason on a second line when a state gate holds.
 */
function WorkspaceActionsMenu({
  gates,
  onOpen,
  ready,
}: {
  gates: WorkspaceActionGates;
  onOpen: (dialog: HeaderDialog) => void;
  /** False until the members landed: transfer's gate waits on their count. */
  ready: boolean;
}) {
  const dangerous =
    gates.transfer.kind !== "hidden" || gates.delete.kind !== "hidden";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <AppIconButton
            aria-label="Workspace actions"
            data-slot="workspace-actions-menu"
            disabled={!ready}
            size="lg"
            variant="secondary"
          >
            <MoreHorizontal aria-hidden className="size-4" />
          </AppIconButton>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        {gates.rename.kind === "hidden" ? null : (
          <MenuAction
            gate={gates.rename}
            icon={<Pencil aria-hidden />}
            label="Rename…"
            onSelect={() => onOpen("rename")}
          />
        )}
        {gates.rename.kind !== "hidden" && dangerous ? (
          <DropdownMenuSeparator />
        ) : null}
        {gates.transfer.kind === "hidden" ? null : (
          <MenuAction
            gate={gates.transfer}
            icon={<ArrowLeftRight aria-hidden />}
            label="Transfer ownership…"
            onSelect={() => onOpen("transfer")}
          />
        )}
        {gates.delete.kind === "hidden" ? null : (
          <MenuAction
            gate={gates.delete}
            icon={<Trash2 aria-hidden />}
            label="Delete workspace…"
            onSelect={() => onOpen("delete")}
            variant="destructive"
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The Managed Workspace's detail header (spec §D.4): a 40px square avatar,
 * the name, the plan badge, a Current badge when it is the session's
 * Workspace; below, the facts line — the user's role or "Personal
 * workspace", and the copyable namespace id. On the right a non-Owner's
 * Leave workspace button (disabled with a tooltip while it is the current
 * Workspace) or the Owner's ⋯ menu. The controls are rendered from the
 * gates and open the dialogs that run the writes (spec §D.7): Rename
 * takes effect on submit, Delete and Transfer ask for the name, Leave
 * asks once.
 */
export function WorkspaceDetailHeader({
  actions,
  gates,
  isCurrent,
  meCrName,
  members,
  planName,
  workspace,
}: {
  actions: WorkspaceActions;
  gates: WorkspaceActionGates;
  isCurrent: boolean;
  meCrName: string;
  /** Undefined until the members landed: the ⋯ menu and Leave wait on them. */
  members: readonly WorkspaceMember[] | undefined;
  planName: string | null | undefined;
  workspace: SessionWorkspace;
}) {
  const [dialog, setDialog] = useState<HeaderDialog | null>(null);
  const closeDialog = (open: boolean) => {
    if (!open) {
      setDialog(null);
    }
  };
  const me = members?.find((member) => member.crName === meCrName);
  const others = (members ?? []).filter((member) => member.crName !== meCrName);
  const leaveReason = disabledReason(gates.leave);
  const showMenu =
    gates.rename.kind !== "hidden" ||
    gates.transfer.kind !== "hidden" ||
    gates.delete.kind !== "hidden";
  return (
    <div
      className="flex items-center gap-3"
      data-slot="workspace-detail-header"
    >
      <WorkspaceAvatar
        className="size-10 rounded-lg"
        square
        workspaceId={workspace.id}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-h-7 min-w-0 items-center gap-2.5">
          <h2 className="truncate font-semibold text-foreground text-lg leading-7">
            {workspace.name}
          </h2>
          <PlanSlot className="shrink-0" planName={planName} />
          {isCurrent ? (
            <Badge
              className="bg-blue-400/10 text-blue-400"
              data-slot="workspace-current-badge"
            >
              Current
            </Badge>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm leading-5">
          <span className="shrink-0" data-slot="workspace-detail-role">
            {workspace.isPersonal
              ? "Personal workspace"
              : `You're ${workspace.role}`}
          </span>
          <span aria-hidden>·</span>
          <AppButton
            aria-label="Copy workspace ID"
            className="h-5 gap-1 rounded-sm px-1 font-mono font-normal text-muted-foreground text-xs hover:text-foreground"
            onClick={() => copyWorkspaceId(workspace.id)}
            size="sm"
            variant="quiet"
          >
            {workspace.id}
            <Copy aria-hidden className="size-3" />
          </AppButton>
        </div>
      </div>
      {gates.leave.kind === "hidden" ? null : (
        <WithReason reason={leaveReason}>
          <AppButton
            aria-label="Leave workspace"
            className="shrink-0"
            disabled={leaveReason != null || me == null}
            onClick={() => setDialog("leave")}
            variant="secondary"
          >
            <LogOut aria-hidden />
            Leave workspace
          </AppButton>
        </WithReason>
      )}
      {showMenu ? (
        <WorkspaceActionsMenu
          gates={gates}
          onOpen={setDialog}
          ready={members != null}
        />
      ) : null}
      {dialog === "rename" ? (
        <WorkspaceRenameDialog
          onOpenChange={closeDialog}
          onRename={actions.rename}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
      {dialog === "delete" ? (
        <WorkspaceDeleteDialog
          onDelete={actions.deleteWorkspace}
          onOpenChange={closeDialog}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
      {dialog === "transfer" ? (
        <WorkspaceTransferDialog
          candidates={others}
          onOpenChange={closeDialog}
          onTransfer={actions.transfer}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
      {dialog === "leave" && me != null ? (
        <WorkspaceLeaveDialog
          onLeave={() => actions.leave(me)}
          onOpenChange={closeDialog}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
    </div>
  );
}
