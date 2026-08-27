import { atom } from "jotai";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

/**
 * The notifications Dev Mock's override: `null` while the mock is off (the
 * merged feed is the writer), a fixture list while it is on. The feed hook
 * reads this so the panel and badge never need to know which is live.
 */
export const notificationsDevMockItemsAtom = atom<
  readonly AppNotification[] | null
>(null);

/**
 * Optimistic read receipts layered over the items' own `unread` flags:
 * clicking a row or "mark all as read" lands here first, and the server
 * receipt (and, best-effort, the CR label) follows. Keyed by the
 * source-prefixed notification id, so a revived platform message (new
 * timestamp, new id) is never covered by a stale receipt.
 */
export const notificationReadIdsAtom = atom<ReadonlySet<string>>(
  new Set<string>()
);
