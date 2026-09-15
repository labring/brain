"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppSelect } from "@workspace/ui/components/app-select";
import { useId, useState } from "react";

import type { SessionWorkspace } from "@/features/session/session-schema";

import {
  nameConfirmed,
  WorkspaceNameConfirmField,
} from "./workspace-confirm-field";
import type { WorkspaceMember } from "./workspace-details-schema";
import { WORKSPACE_NAME_MAX_LENGTH } from "./workspace-write-schema";

/**
 * The detail header's dialogs (spec §D.4, §D.7): Rename takes effect on
 * submit; Delete and Transfer ownership ask for the Workspace's name;
 * Leave is a plain confirmation. Each is mounted only while open, so its
 * fields start fresh every time.
 */

function memberDisplayName(member: WorkspaceMember): string {
  return member.nickname.trim() === "" ? member.crName : member.nickname;
}

export function WorkspaceRenameDialog({
  onOpenChange,
  onRename,
  pending,
  workspace,
}: {
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => Promise<boolean>;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  const [name, setName] = useState(workspace.name);
  const inputId = useId();
  const trimmed = name.trim();
  const unchanged = trimmed === workspace.name;
  const submit = async () => {
    if (trimmed === "" || unchanged) {
      return;
    }
    if (await onRename(trimmed)) {
      onOpenChange(false);
    }
  };
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-rename-dialog" size="sm">
        <AppDialog.Header>
          <AppDialog.Title>Rename workspace</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              submit().catch(() => undefined);
            }}
          >
            <AppDialog.Field>
              <AppDialog.Label htmlFor={inputId}>
                Workspace name
              </AppDialog.Label>
              <AppDialog.Input
                autoComplete="off"
                autoFocus
                id={inputId}
                maxLength={WORKSPACE_NAME_MAX_LENGTH}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </AppDialog.Field>
          </form>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.Action
            disabled={trimmed === "" || unchanged}
            loading={pending}
            onClick={() => {
              submit().catch(() => undefined);
            }}
          >
            Rename
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export function WorkspaceDeleteDialog({
  onDelete,
  onOpenChange,
  pending,
  workspace,
}: {
  onDelete: () => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  const [typed, setTyped] = useState("");
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-delete-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Delete workspace?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            This deletes{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>{" "}
            with everything in it, and every member loses access. This cannot be
            undone.
          </AppDialog.Description>
          <WorkspaceNameConfirmField
            name={workspace.name}
            onChange={setTyped}
            value={typed}
          />
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.DestructiveAction
            disabled={!nameConfirmed(typed, workspace.name)}
            loading={pending}
            onClick={() => {
              onDelete()
                .then((done) => {
                  if (done) {
                    onOpenChange(false);
                  }
                })
                .catch(() => undefined);
            }}
          >
            Delete workspace
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export function WorkspaceTransferDialog({
  candidates,
  onOpenChange,
  onTransfer,
  pending,
  workspace,
}: {
  /** The other members: whoever can receive ownership. */
  candidates: readonly WorkspaceMember[];
  onOpenChange: (open: boolean) => void;
  onTransfer: (member: WorkspaceMember) => Promise<boolean>;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  const [typed, setTyped] = useState("");
  const [targetCrUid, setTargetCrUid] = useState<string | undefined>(undefined);
  const target = candidates.find((member) => member.crUid === targetCrUid);
  const selectId = useId();
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-transfer-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Transfer ownership?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            The new Owner takes over{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>
            , its billing included.{" "}
            <span
              className="font-medium text-foreground"
              data-slot="workspace-transfer-consequence"
            >
              You will become a Developer.
            </span>
          </AppDialog.Description>
          <AppDialog.Field>
            <AppDialog.Label htmlFor={selectId}>New owner</AppDialog.Label>
            <AppSelect
              aria-label="New owner"
              id={selectId}
              onValueChange={setTargetCrUid}
              options={candidates.map((member) => ({
                label: `${memberDisplayName(member)} · ${member.role}`,
                textValue: memberDisplayName(member),
                value: member.crUid,
              }))}
              placeholder="Select a member"
              value={targetCrUid}
            />
          </AppDialog.Field>
          <WorkspaceNameConfirmField
            name={workspace.name}
            onChange={setTyped}
            value={typed}
          />
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.DestructiveAction
            disabled={target == null || !nameConfirmed(typed, workspace.name)}
            loading={pending}
            onClick={() => {
              if (target == null) {
                return;
              }
              onTransfer(target)
                .then((done) => {
                  if (done) {
                    onOpenChange(false);
                  }
                })
                .catch(() => undefined);
            }}
          >
            Transfer ownership
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export function WorkspaceLeaveDialog({
  onLeave,
  onOpenChange,
  pending,
  workspace,
}: {
  onLeave: () => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-leave-dialog" size="sm">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Leave workspace?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            You lose access to{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>
            . An Owner or Manager can invite you again.
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending} />
          <AppDialog.DestructiveAction
            loading={pending}
            onClick={() => {
              onLeave()
                .then((done) => {
                  if (done) {
                    onOpenChange(false);
                  }
                })
                .catch(() => undefined);
            }}
          >
            Leave
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
