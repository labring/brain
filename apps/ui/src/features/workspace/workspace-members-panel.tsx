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

import type { WorkspaceMember } from "./workspace-details-schema";
import {
  ASSIGNABLE_ROLES,
  gateMemberActions,
  type WorkspaceActionGate,
  type WorkspaceGateInput,
} from "./workspace-gating-core";

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

function memberName(member: WorkspaceMember): string {
  return member.nickname.trim() === "" ? member.crName : member.nickname;
}

function MemberAvatar({ member }: { member: WorkspaceMember }) {
  const name = memberName(member);
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
  gate,
  member,
}: {
  gate: WorkspaceActionGate;
  member: WorkspaceMember;
}) {
  if (gate.kind === "enabled") {
    // The operation behind the choice arrives with the write routes; the
    // control is rendered where it will live so the gating is reviewable.
    return (
      <AppSelect
        aria-label={`Role of ${memberName(member)}`}
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
  gateInput,
  isSelf,
  member,
  showActions,
}: {
  gateInput: WorkspaceGateInput;
  isSelf: boolean;
  member: WorkspaceMember;
  showActions: boolean;
}) {
  const gates = gateMemberActions(gateInput, {
    isSelf,
    targetRole: member.role,
  });
  const name = memberName(member);
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
            <button
              aria-label={`${member.alias == null ? "Set" : "Edit"} alias for ${name}`}
              className="inline-flex shrink-0 items-center gap-1 self-center text-muted-foreground text-xs opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              data-slot="workspace-member-alias-edit"
              type="button"
            >
              <Pencil aria-hidden className="size-3.5" />
              {member.alias == null ? "Set alias" : "Edit alias"}
            </button>
          ) : null}
        </div>
      </TableCell>
      <TableCell className={CELL_CLASS}>
        <RoleCell gate={gates.changeRole} member={member} />
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
  gateInput,
  meCrName,
  members,
}: {
  gateInput: WorkspaceGateInput;
  meCrName: string;
  members: readonly WorkspaceMember[];
}) {
  // The action column exists only when the actor can remove someone.
  const showActions = members.some(
    (member) =>
      gateMemberActions(gateInput, {
        isSelf: member.crName === meCrName,
        targetRole: member.role,
      }).remove.kind === "enabled"
  );
  return (
    <div
      className="min-h-0 shrink overflow-y-auto rounded-lg border border-border [&>[data-slot=table-container]]:overflow-visible"
      data-slot="workspace-members-table"
    >
      <Table>
        <TableHeader className="sticky top-0 z-10">
          <TableRow className="hover:bg-transparent">
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
          {members.map((member) => (
            <MemberRow
              gateInput={gateInput}
              isSelf={member.crName === meCrName}
              key={member.crUid}
              member={member}
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
  error,
  gateInput,
  meCrName,
  members,
}: {
  error: Error | undefined;
  gateInput: WorkspaceGateInput;
  meCrName: string;
  members: readonly WorkspaceMember[] | undefined;
}) {
  if (members != null) {
    return (
      <MembersTable
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
 * everyone listed has joined.
 */
export function WorkspaceMembersPanel({
  error,
  gateInput,
  inviteGate,
  meCrName,
  members,
}: {
  error: Error | undefined;
  gateInput: WorkspaceGateInput;
  inviteGate: WorkspaceActionGate;
  meCrName: string;
  /** Undefined while the members are loading. */
  members: readonly WorkspaceMember[] | undefined;
}) {
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
            <span
              className="font-normal text-muted-foreground text-sm"
              data-slot="workspace-members-count"
            >
              {members.length}
            </span>
          )}
        </h3>
        {inviteGate.kind === "hidden" ? null : (
          <AppButton aria-label="Invite member" variant="secondary">
            <UserRoundPlus aria-hidden />
            Invite member
          </AppButton>
        )}
      </div>
      <MembersBody
        error={error}
        gateInput={gateInput}
        meCrName={meCrName}
        members={members}
      />
    </section>
  );
}
