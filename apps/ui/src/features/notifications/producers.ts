import "server-only";

import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";

import { observeWorkspaceQuotaForNotifications } from "./producer-quota-exhausted";
import { notificationStore } from "./server-store";

/**
 * Fire-and-forget quota observation for request paths that already carry a
 * snapshot (the chat turn). The producer must never fail the user's request:
 * a persistence hiccup is logged and the next observation retries by naming.
 */
export function observeWorkspaceQuotaQuietly(input: {
  namespace: string;
  snapshot: WorkspaceResourceQuotaSnapshot;
}): void {
  observeWorkspaceQuotaForNotifications(notificationStore, input).catch(
    (error: unknown) => {
      console.error(
        "[notifications] quota observation failed:",
        error instanceof Error ? error.message : String(error)
      );
    }
  );
}
