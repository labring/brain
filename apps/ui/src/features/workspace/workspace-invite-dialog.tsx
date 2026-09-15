"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppSelect } from "@workspace/ui/components/app-select";
import { Link2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type {
  SessionWorkspace,
  WorkspaceRole,
} from "@/features/session/session-schema";

import { inviteRoleOptions } from "./workspace-gating-core";
import {
  INVITE_LINK_VALIDITY_NOTE,
  workspaceInviteUrl,
} from "./workspace-invite-core";
import type { AssignableRole } from "./workspace-write-schema";

export const INVITE_LINK_COPIED_NOTICE = "Invite link copied.";
export const INVITE_LINK_NO_DESKTOP_NOTICE =
  "Couldn't build the link: the Desktop domain is unknown.";

const DEFAULT_INVITE_ROLE: AssignableRole = "Developer";

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.clipboard == null) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The invite dialog (spec §D.6): a role per the matrix (an Owner offers
 * Manager and Developer, a Manager only Developer; Developer by default),
 * "Copy invite link" which asks Brain for a code, builds Desktop's link,
 * writes it to the clipboard, and keeps it on show, selectable, beside a
 * fixed note that it lasts 30 minutes. Changing the role clears the link.
 */
export function WorkspaceInviteDialog({
  actorRole,
  cloudDomain,
  onCreateLink,
  onOpenChange,
  pending,
  workspace,
}: {
  actorRole: WorkspaceRole;
  /** Desktop's cloud domain; "" while unknown. */
  cloudDomain: string;
  onCreateLink: (role: AssignableRole) => Promise<string | null>;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  workspace: SessionWorkspace;
}) {
  const roles = inviteRoleOptions(actorRole);
  const [role, setRole] = useState<AssignableRole>(
    roles.includes(DEFAULT_INVITE_ROLE)
      ? DEFAULT_INVITE_ROLE
      : ((roles[0] as AssignableRole | undefined) ?? DEFAULT_INVITE_ROLE)
  );
  const [link, setLink] = useState<string | null>(null);
  const selectId = useId();

  const createLink = async () => {
    const code = await onCreateLink(role);
    if (code == null) {
      return;
    }
    const url = workspaceInviteUrl({ cloudDomain, code });
    if (url == null) {
      toast(INVITE_LINK_NO_DESKTOP_NOTICE);
      return;
    }
    setLink(url);
    if (await copyText(url)) {
      toast(INVITE_LINK_COPIED_NOTICE);
    }
  };

  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="workspace-invite-dialog">
        <AppDialog.Header>
          <AppDialog.Title>Invite member</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            Anyone with the link joins{" "}
            <span className="font-medium text-foreground">
              {workspace.name}
            </span>{" "}
            in the role you pick.
          </AppDialog.Description>
          <AppDialog.Field>
            <AppDialog.Label htmlFor={selectId}>Role</AppDialog.Label>
            <AppSelect
              aria-label="Invite role"
              id={selectId}
              onValueChange={(next) => {
                setRole(next as AssignableRole);
                setLink(null);
              }}
              options={roles.map((option) => ({
                label: option,
                value: option,
              }))}
              value={role}
            />
          </AppDialog.Field>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <AppDialog.Action
                loading={pending}
                loadingLabel="Creating link…"
                onClick={() => {
                  createLink().catch(() => undefined);
                }}
              >
                <Link2 aria-hidden />
                Copy invite link
              </AppDialog.Action>
              {link == null ? null : (
                <code
                  className="min-w-0 select-all truncate rounded-md bg-input/30 px-2 py-1.5 font-mono text-foreground text-xs"
                  data-slot="workspace-invite-link"
                  title={link}
                >
                  {link}
                </code>
              )}
            </div>
            <p
              className="text-muted-foreground text-xs"
              data-slot="workspace-invite-validity"
            >
              {INVITE_LINK_VALIDITY_NOTE}
            </p>
          </div>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Close</AppDialog.Cancel>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
