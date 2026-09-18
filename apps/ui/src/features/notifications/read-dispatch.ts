import type { WorkspaceRole } from "@/features/session/session-schema";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

/**
 * Per-source mark-read dispatch. Any role always writes a Brain receipt for
 * every id; platform items additionally patch the CR's `isRead` label so the
 * desktop bell follows — but only for roles the cluster lets patch. Owners
 * and Managers hold that permission, Developers do not. The role is the
 * Brain Session's Workspace Role for the current Workspace (spec §J.1);
 * an unknown role (no session yet) tries and lets a 403 fall through.
 */
export interface ReadDispatch {
  /** CR names to patch best-effort. */
  crNames: string[];
  /** Source-prefixed ids to record receipts for (always every id). */
  receiptIds: string[];
}

export function shouldSyncCRReadLabel(
  role: WorkspaceRole | null | undefined
): boolean {
  return role !== "Developer";
}

export function planReadDispatch(
  items: readonly AppNotification[],
  role: WorkspaceRole | null | undefined
): ReadDispatch {
  const receiptIds = [...new Set(items.map((item) => item.id))];
  const crNames = shouldSyncCRReadLabel(role)
    ? [
        ...new Set(
          items.flatMap((item) =>
            item.source === "cr" && item.crName != null ? [item.crName] : []
          )
        ),
      ]
    : [];
  return { crNames, receiptIds };
}
