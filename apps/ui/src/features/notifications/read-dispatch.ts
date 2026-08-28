import type { WorkspaceSubscriptionRole } from "@/features/billing/billing-plan-data";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

/**
 * Per-source mark-read dispatch. Any role always writes a Brain receipt for
 * every id; platform items additionally patch the CR's `isRead` label so the
 * desktop bell follows — but only for roles the cluster lets patch. Owners
 * and Managers hold that permission, Developers do not, and an unknown role
 * (PAYG workspaces carry none) tries and lets a 403 fall through silently.
 */
export interface ReadDispatch {
  /** CR names to patch best-effort. */
  crNames: string[];
  /** Source-prefixed ids to record receipts for (always every id). */
  receiptIds: string[];
}

export function shouldSyncCRReadLabel(
  role: WorkspaceSubscriptionRole | null | undefined
): boolean {
  return role !== "DEVELOPER";
}

export function planReadDispatch(
  items: readonly AppNotification[],
  role: WorkspaceSubscriptionRole | null | undefined
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
