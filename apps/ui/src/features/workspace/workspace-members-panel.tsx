"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppSelect } from "@workspace/ui/components/app-select";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { Pencil, UserMinus, UserRoundPlus, UsersRound } from "lucide-react";
import { useState } from "react";

import type { SessionWorkspace } from "@/features/session/session-schema";

import type { WorkspaceActions } from "./use-workspace-actions";
import {
  memberDisplayName,
  type WorkspaceMember,
} from "./workspace-details-schema";
import {
  ASSIGNABLE_ROLES,
  gateMemberActions,
  type MemberActionGates,
  type WorkspaceActionGate,
  type WorkspaceGateInput,
} from "./workspace-gating-core";
import { WorkspaceInviteDialog } from "./workspace-invite-dialog";
import {
  WorkspaceAliasDialog,
  WorkspaceRemoveMemberDialog,
} from "./workspace-member-dialogs";
import { assignableRoleSchema } from "./workspace-write-schema";

type PanelDialog =
  | { kind: "alias"; member: WorkspaceMember }
  | { kind: "invite" }
  | { kind: "remove"; member: WorkspaceMember };

/** What a member row can open, and the writes behind its controls. */
interface RowActions {
  changeRole: WorkspaceActions["changeRole"];
  open: (dialog: PanelDialog) => void;
  pending: boolean;
}

export const MEMBERS_LOAD_FAILED_NOTICE = "Couldn't load the members.";

const HEAD_CLASS = "h-11 bg-input/30 font-medium text-muted-foreground text-xs";
const CELL_CLASS = "h-14 py-0 text-sm";

const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({
  label: role,
  value: role,
}));

/** "Feb 14, 2026" (spec §D.5); "-" for a date Desktop did not give. */
export function formatJoinedDate(iso: string): string {
  const date = new Date(iso);
  if (iso === "" || Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  const name = memberDisplayName(member);
  return (
    <Avatar className="size-8 text-sm" size="default">
      {member.avatarUrl === "" ? null : (
        <AvatarImage alt="" src={member.avatarUrl} />
      )}
      <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

function RoleCell({
  actions,
  gate,
  member,
}: {
  actions: RowActions;
  gate: WorkspaceActionGate;
  member: WorkspaceMember;
}) {
  if (gate.kind === "enabled") {
    // Choosing takes effect at once (spec §D.7); the table re-reads after.
    return (
      <AppSelect
        aria-label={`Role of ${memberDisplayName(member)}`}
        disabled={actions.pending}
        onValueChange={(next) => {
          const role = assignableRoleSchema.safeParse(next);
          if (role.success && role.data !== member.role) {
            actions.changeRole(member, role.data).catch(() => undefined);
          }
        }}
        options={ROLE_OPTIONS}
        triggerClassName="-ml-2 h-8 w-32 border-transparent bg-transparent px-2 text-sm hover:bg-input/30"
        value={member.role}
      />
    );
  }
  return (
    <span
      className={cn(member.role === "Owner" && "text-blue-400")}
      data-slot="workspace-member-role"
    >
      {member.role}
    </span>
  );
}

function MemberRow({
  actions,
  gates,
  isSelf,
  member,
  showActions,
}: {
  actions: RowActions;
  gates: MemberActionGates;
  isSelf: boolean;
  member: WorkspaceMember;
  showActions: boolean;
}) {
  const name = memberDisplayName(member);
  return (
    <TableRow
      className="group/row"
      data-member-role={member.role}
      data-slot="workspace-member-row"
    >
      <TableCell className={CELL_CLASS}>
        <div className="flex min-w-0 items-center gap-3">
          <MemberAvatar member={member} />
          <div className="flex min-w-0 flex-col justify-center gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{name}</span>
              {isSelf ? (
                <Badge
                  className="h-5 shrink-0 bg-input/40 px-1.5 font-normal text-muted-foreground text-xs"
                  data-slot="workspace-member-you"
                  variant="secondary"
                >
                  You
                </Badge>
              ) : null}
            </div>
            {member.alias == null ? null : (
              <span
                className="truncate text-muted-foreground text-xs"
                data-slot="workspace-member-alias"
              >
                {member.alias}
              </span>
            )}
          </div>
          {gates.setAlias.kind === "enabled" ? (
            <AppButton
              aria-label={`${member.alias == null ? "Set" : "Edit"} alias for ${name}`}
              className="shrink-0 self-center text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              data-slot="workspace-member-alias-edit"
              onClick={() => actions.open({ kind: "alias", member })}
              size="sm"
              variant="quiet"
            >
              <Pencil aria-hidden />
              {member.alias == null ? "Set alias" : "Edit alias"}
            </AppButton>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={CELL_CLASS}>
        <RoleCell actions={actions} gate={gates.changeRole} member={member} />
      </TableCell>
      <TableCell className={cn(CELL_CLASS, "text-muted-foreground")}>
        {formatJoinedDate(member.joinedAt)}
      </TableCell>
      {showActions ? (
        <TableCell className={cn(CELL_CLASS, "pr-3 text-right")}>
          {gates.remove.kind === "enabled" ? (
            <AppIconButton
              aria-label={`Remove ${name}`}
              className="text-muted-foreground hover:text-red-400"
              data-slot="workspace-member-remove"
              onClick={() => actions.open({ kind: "remove", member })}
              size="md"
              variant="quiet"
            >
              <UserMinus aria-hidden className="size-4" />
            </AppIconButton>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function MembersTable({
  actions,
  gateInput,
  meCrName,
  members,
}: {
  actions: RowActions;
  gateInput: WorkspaceGateInput;
  meCrName: string;
  members: readonly WorkspaceMember[];
}) {
  const rows = members.map((member) => {
    const isSelf = member.crName === meCrName;
    return {
      gates: gateMemberActions(gateInput, { isSelf, targetRole: member.role }),
      isSelf,
      member,
    };
  });
  // The action column exists only when the actor can remove someone.
  const showActions = rows.some((row) => row.gates.remove.kind === "enabled");
  return (
    <div
      className="min-h-0 shrink overflow-y-auto rounded-lg border border-border [&>[data-slot=table-container]]:overflow-visible"
      data-slot="workspace-members-table"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="hover:bg-transparent">
            {/* Column widths are the design's (spec §D.5: 46 / 22 / 22, the rest to actions). */}
            <TableHead className={cn(HEAD_CLASS, "w-[46%]")}>Member</TableHead>
            <TableHead className={cn(HEAD_CLASS, "w-[22%]")}>Role</TableHead>
            <TableHead className={cn(HEAD_CLASS, "w-[22%]")}>Joined</TableHead>
            {showActions ? (
              <TableHead className={HEAD_CLASS}>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <MemberRow
              actions={actions}
              gates={row.gates}
              isSelf={row.isSelf}
              key={row.member.crUid}
              member={row.member}
              showActions={showActions}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The table once the members landed; otherwise why they have not. */
function MembersBody({
  actions,
  error,
  gateInput,
  meCrName,
  members,
}: {
  actions: RowActions;
  error: Error | undefined;
  gateInput: WorkspaceGateInput;
  meCrName: string;
  members: readonly WorkspaceMember[] | undefined;
}) {
  if (members != null) {
    return (
      <MembersTable
        actions={actions}
        gateInput={gateInput}
        meCrName={meCrName}
        members={members}
      />
    );
  }
  if (error != null) {
    return (
      <p
        className="text-muted-foreground text-sm"
        data-slot="workspace-members-error"
      >
        {MEMBERS_LOAD_FAILED_NOTICE}
      </p>
    );
  }
  return (
    <p
      aria-busy
      className="text-muted-foreground text-sm"
      data-slot="workspace-members-loading"
    >
      Loading members…
    </p>
  );
}

/**
 * The Members panel (spec §D.5): flush to the bottom with rounded top
 * corners, "Members · N" and the Invite member button (Owner and Manager)
 * over a bordered table that scrolls inside itself with its header pinned.
 * Columns Member (avatar, name, You, alias, the hover pencil) / Role (a
 * quiet select where the actor may change it, text otherwise, Owner in
 * blue) / Joined / the remove icon where the actor may remove that row —
 * the whole column is absent when no row is removable. No Status column:
 * everyone listed has joined. The controls open the dialogs that run the
 * writes: alias and role take effect on submit, removal asks once, the
 * invite dialog hands out a Workspace Invite Link.
 */
export function WorkspaceMembersPanel({
  actions,
  cloudDomain,
  error,
  gateInput,
  inviteGate,
  meCrName,
  members,
  workspace,
}: {
  actions: WorkspaceActions;
  /** Desktop's cloud domain for the invite link; "" while unknown. */
  cloudDomain: string;
  error: Error | undefined;
  gateInput: WorkspaceGateInput;
  inviteGate: WorkspaceActionGate;
  meCrName: string;
  /** Undefined while the members are loading. */
  members: readonly WorkspaceMember[] | undefined;
  workspace: SessionWorkspace;
}) {
  const [dialog, setDialog] = useState<PanelDialog | null>(null);
  const closeDialog = (open: boolean) => {
    if (!open) {
      setDialog(null);
    }
  };
  const rowActions: RowActions = {
    changeRole: actions.changeRole,
    open: setDialog,
    pending: actions.pending,
  };
  return (
    <section
      className="flex min-h-0 flex-1 flex-col gap-4 rounded-t-lg bg-input/30 p-4"
      data-slot="workspace-members-panel"
    >
      <div className="flex min-h-9 items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium text-base text-foreground leading-6">
          <UsersRound aria-hidden className="size-4" />
          Members
          {members == null ? null : (
            <>
              <span aria-hidden className="font-normal text-muted-foreground">
                ·
              </span>
              <span
                className="font-normal text-muted-foreground text-sm"
                data-slot="workspace-members-count"
              >
                {members.length}
              </span>
            </>
          )}
        </h3>
        {inviteGate.kind === "hidden" ? null : (
          <AppButton
            aria-label="Invite member"
            onClick={() => setDialog({ kind: "invite" })}
            variant="secondary"
          >
            <UserRoundPlus aria-hidden />
            Invite member
          </AppButton>
        )}
      </div>
      <MembersBody
        actions={rowActions}
        error={error}
        gateInput={gateInput}
        meCrName={meCrName}
        members={members}
      />
      {dialog?.kind === "alias" ? (
        <WorkspaceAliasDialog
          member={dialog.member}
          onOpenChange={closeDialog}
          onSave={(alias) => actions.setAlias(dialog.member, alias)}
          pending={actions.pending}
        />
      ) : null}
      {dialog?.kind === "remove" ? (
        <WorkspaceRemoveMemberDialog
          member={dialog.member}
          onOpenChange={closeDialog}
          onRemove={() => actions.removeMember(dialog.member)}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
      {dialog?.kind === "invite" ? (
        <WorkspaceInviteDialog
          actorRole={gateInput.actorRole}
          cloudDomain={cloudDomain}
          onCreateLink={actions.createInviteLink}
          onOpenChange={closeDialog}
          pending={actions.pending}
          workspace={workspace}
        />
      ) : null}
    </section>
  );
}
