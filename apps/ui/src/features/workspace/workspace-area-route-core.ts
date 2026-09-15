import type { SessionWorkspace } from "@/features/session/session-schema";

/**
 * The Workspace Area's route judgment (spec §D.1): which Workspace the URL
 * names as the Managed Workspace, or where to go instead. `/workspace`
 * without a uid replaces itself with the current Workspace; a uid outside
 * the user's list does the same and says so. Nothing is judged before the
 * session has a current Workspace.
 */

export const WORKSPACE_NOT_IN_LIST_NOTICE =
  "That Workspace is not in your list.";

export function workspaceAreaPath(uid: string): string {
  return `/workspace/${encodeURIComponent(uid)}`;
}

export type ManagedWorkspaceResolution =
  | { kind: "managed"; workspace: SessionWorkspace }
  | { kind: "pending" }
  | { kind: "redirect"; notice: string | null; to: string };

export function resolveManagedWorkspace(input: {
  /** The current Workspace's uid; null until the session is established. */
  currentUid: string | null;
  /** The `[uid]` segment; null on `/workspace` itself. */
  uid: string | null;
  workspaces: readonly SessionWorkspace[];
}): ManagedWorkspaceResolution {
  if (input.currentUid == null) {
    return { kind: "pending" };
  }
  if (input.uid == null || input.uid === "") {
    return {
      kind: "redirect",
      notice: null,
      to: workspaceAreaPath(input.currentUid),
    };
  }
  const workspace = input.workspaces.find(
    (candidate) => candidate.uid === input.uid
  );
  if (workspace != null) {
    return { kind: "managed", workspace };
  }
  return {
    kind: "redirect",
    notice: WORKSPACE_NOT_IN_LIST_NOTICE,
    to: workspaceAreaPath(input.currentUid),
  };
}
