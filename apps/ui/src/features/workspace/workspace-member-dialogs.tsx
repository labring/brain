"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { useId, useState } from "react";

import type { SessionWorkspace } from "@/features/session/session-schema";

import type { WorkspaceMember } from "./workspace-details-schema";
import { WORKSPACE_ALIAS_MAX_LENGTH } from "./workspace-write-schema";

/**
 * The members table's dialogs (spec §D.5, §D.7): the alias editor saves on
 * submit (an empty alias clears it), removing a member is a plain
 * confirmation. Mounted only while open, so the fields start fresh.
 */

export function memberDisplayName(member: WorkspaceMember): string {
  return member.nickname.trim() === "" ? member.crName : member.nickname;
}

export function WorkspaceAliasDialog({
  member,
  onOpenChange,
  onSave,
  pending,
}: {
  member: WorkspaceMember;
  onOpenChange: (open: boolean) => void;
  onSave: (alias: string) => Promise<boolean>;
  pending: boolean;
}) {
  const [alias, setAlias] = useState(member.alias ?? "");
  const inputId = useId();
  const unchanged = alias.trim() === (member.alias ?? "");
  const submit = async () => {
    if (unchanged) {
      return;
    }
    if (await onSave(alias)) {
      onOpenChange(false);
    }
  };
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-alias-dialog" size="sm">
        <AppDialog.Header>
          <AppDialog.Title>
            {member.alias == null ? "Set alias" : "Edit alias"}
          </AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            How{" "}
            <span className="font-medium text-foreground">
              {memberDisplayName(member)}
            </span>{" "}
            is labelled in this workspace. Leave it empty to clear the alias.
          </AppDialog.Description>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              submit().catch(() => undefined);
            }}
          >
            <AppDialog.Field>
              <AppDialog.Label htmlFor={inputId}>Alias</AppDialog.Label>
              <AppDialog.Input
                autoComplete="off"
                autoFocus
                id={inputId}
                maxLength={WORKSPACE_ALIAS_MAX_LENGTH}
                onChange={(event) => setAlias(event.target.value)}
                value={alias}
              />
            </AppDialog.Field>
          </form>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.Action
            disabled={unchanged}
            loading={pending}
            onClick={() => {
              submit().catch(() => undefined);
            }}
          >
            Save
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export function WorkspaceRemoveMemberDialog({
  member,
  onOpenChange,
  onRemove,
  pending,
  workspace,
}: {
  member: WorkspaceMember;
  onOpenChange: (open: boolean) => void;
  onRemove: () => Promise<boolean>;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-remove-member-dialog" size="sm">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Remove member?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            <span className="font-medium text-foreground">
              {memberDisplayName(member)}
            </span>{" "}
            loses access to{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>
            . They can be invited again later.
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.DestructiveAction
            loading={pending}
            onClick={() => {
              onRemove()
                .then((done) => {
                  if (done) {
                    onOpenChange(false);
                  }
                })
                .catch(() => undefined);
            }}
          >
            Remove
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
