import { atom } from "jotai";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

/**
 * The Notification Center's items. Empty until a data source writes it — in
 * the shell phase only the dev mock does, so production users see the empty
 * state. A future real feed replaces the writer, not the readers.
 */
export const appNotificationsAtom = atom<readonly AppNotification[]>([]);

/**
 * Session-local read receipts layered over the items' own `unread` flags:
 * clicking a row or "mark all as read" lands here. Deliberately not
 * persisted while notifications have no backend identity to key on.
 */
export const notificationReadIdsAtom = atom<ReadonlySet<string>>(
  new Set<string>()
);
