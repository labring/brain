"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { SessionWorkspace } from "@/features/session/session-schema";

import { useWorkspaceRefresh } from "./use-workspace-refresh";
import {
  changeWorkspaceMemberRole,
  createWorkspaceInviteLink,
  deleteWorkspace,
  removeWorkspaceMember,
  renameWorkspace,
  setWorkspaceMemberAlias,
  transferWorkspaceOwnership,
} from "./workspace-actions";
import type { WorkspaceMember } from "./workspace-details-schema";
import { WorkspaceRequestError } from "./workspace-request";
import type { AssignableRole } from "./workspace-write-schema";

export const PERMISSIONS_CHANGED_NOTICE = "Your permissions have changed.";

export const WORKSPACE_ACTION_FAILED_NOTICES = {
  alias: "Couldn't save the alias.",
  changeRole: "Couldn't change the role.",
  delete: "Couldn't delete the workspace.",
  inviteLink: "Couldn't create the invite link.",
  leave: "Couldn't leave the workspace.",
  remove: "Couldn't remove the member.",
  rename: "Couldn't rename the workspace.",
  transfer: "Couldn't transfer ownership.",
} as const;

export function workspaceDeletedNotice(name: string): string {
  return `Deleted ${name}.`;
}

export function workspaceLeftNotice(name: string): string {
  return `You left ${name}.`;
}

/** What happens to the page after a write lands. */
type Convergence =
  /** Re-read the list and the member table; the page re-gates from them. */
  | "refresh"
  /** The Managed Workspace is gone for the actor: leave for the current one. */
  | "gone"
  /** Nothing on the page changed (an invite link). */
  | "none";

export interface WorkspaceActions {
  changeRole(member: WorkspaceMember, role: AssignableRole): Promise<boolean>;
  /** The code on success, null when refused. */
  createInviteLink(role: AssignableRole): Promise<string | null>;
  deleteWorkspace(): Promise<boolean>;
  leave(me: WorkspaceMember): Promise<boolean>;
  /** True while any write is in flight; the controls wait on it. */
  pending: boolean;
  removeMember(member: WorkspaceMember): Promise<boolean>;
  rename(name: string): Promise<boolean>;
  setAlias(member: WorkspaceMember, alias: string): Promise<boolean>;
  transfer(member: WorkspaceMember): Promise<boolean>;
}

/**
 * The Workspace Area's writes with their convergence (spec §D.8): after a
 * success, `list` and `details` are re-read (never guessed); a delete or a
 * leave moves the page to the current Workspace first, since the one it
 * showed is gone for the actor (`onGone` is the area's navigation); a
 * 403 / 404 means Desktop's view of the actor changed under the page —
 * re-read, re-gate, and say so. No write switches the current Workspace.
 */
export function useWorkspaceActions(input: {
  /** The Managed Workspace is gone for the actor: leave it for the current one. */
  onGone: () => void;
  workspace: SessionWorkspace;
}): WorkspaceActions {
  const { onGone, workspace } = input;
  const refresh = useWorkspaceRefresh();
  const [pending, setPending] = useState(false);

  const perform = useCallback(
    async <T>(
      write: () => Promise<T>,
      options: { convergence: Convergence; failureNotice: string }
    ): Promise<T | null> => {
      setPending(true);
      try {
        const result = await write();
        if (options.convergence === "gone") {
          onGone();
          await refresh({ details: false });
        } else if (options.convergence === "refresh") {
          await refresh();
        }
        return result;
      } catch (error) {
        if (error instanceof WorkspaceRequestError && error.standingChanged) {
          await refresh();
          toast(PERMISSIONS_CHANGED_NOTICE);
        } else {
          toast(options.failureNotice);
        }
        return null;
      } finally {
        setPending(false);
      }
    },
    [onGone, refresh]
  );

  const uid = workspace.uid;
  const name = workspace.name;

  return {
    changeRole: useCallback(
      async (member, role) =>
        (await perform(
          () => changeWorkspaceMemberRole({ crUid: member.crUid, role, uid }),
          {
            convergence: "refresh",
            failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.changeRole,
          }
        )) != null,
      [perform, uid]
    ),
    createInviteLink: useCallback(
      async (role) =>
        (
          await perform(() => createWorkspaceInviteLink({ role, uid }), {
            convergence: "none",
            failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.inviteLink,
          })
        )?.code ?? null,
      [perform, uid]
    ),
    deleteWorkspace: useCallback(async () => {
      const done =
        (await perform(() => deleteWorkspace({ uid }), {
          convergence: "gone",
          failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.delete,
        })) != null;
      if (done) {
        toast(workspaceDeletedNotice(name));
      }
      return done;
    }, [name, perform, uid]),
    leave: useCallback(
      async (me) => {
        const done =
          (await perform(
            () => removeWorkspaceMember({ crUid: me.crUid, uid }),
            {
              convergence: "gone",
              failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.leave,
            }
          )) != null;
        if (done) {
          toast(workspaceLeftNotice(name));
        }
        return done;
      },
      [name, perform, uid]
    ),
    pending,
    removeMember: useCallback(
      async (member) =>
        (await perform(
          () => removeWorkspaceMember({ crUid: member.crUid, uid }),
          {
            convergence: "refresh",
            failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.remove,
          }
        )) != null,
      [perform, uid]
    ),
    rename: useCallback(
      async (nextName) =>
        (await perform(() => renameWorkspace({ name: nextName, uid }), {
          convergence: "refresh",
          failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.rename,
        })) != null,
      [perform, uid]
    ),
    setAlias: useCallback(
      async (member, alias) =>
        (await perform(
          () => setWorkspaceMemberAlias({ alias, crUid: member.crUid, uid }),
          {
            convergence: "refresh",
            failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.alias,
          }
        )) != null,
      [perform, uid]
    ),
    transfer: useCallback(
      async (member) =>
        (await perform(
          () => transferWorkspaceOwnership({ crUid: member.crUid, uid }),
          {
            convergence: "refresh",
            failureNotice: WORKSPACE_ACTION_FAILED_NOTICES.transfer,
          }
        )) != null,
      [perform, uid]
    ),
  };
}
