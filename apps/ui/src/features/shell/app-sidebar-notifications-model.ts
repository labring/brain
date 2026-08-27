/**
 * The Notification Center's model: what one Notification is, plus the pure
 * derivations the panel renders from (unread accounting, tab filtering, the
 * entry badge). Items arrive from the merged feed
 * (`@/features/notifications/feed-model`): platform CRs read live from the
 * cluster and Brain-produced entries from Brain's own store, one list sorted
 * by real time.
 */

export type AppNotificationKind =
  | "announcement"
  | "billing"
  | "deploy-failure"
  | "deploy-success"
  | "quota";

/** Which stream a Notification came from; also its id prefix. */
export type AppNotificationSource = "cr" | "db";

/**
 * One Notification: a message addressed to the current user, aggregated
 * across Projects. `id` is source-prefixed (`cr:<name>:<timestamp>` or
 * `db:<id>`) and doubles as the read-receipt key; `timestamp` is epoch
 * milliseconds; `unread` is the item's own state (the CR label, or "never
 * read" for Brain entries) before receipts are applied on top.
 */
export interface AppNotification {
  body?: string;
  /** The CR to patch when a `cr:` item is marked read (best-effort). */
  crName?: string;
  id: string;
  kind: AppNotificationKind;
  project?: string;
  source: AppNotificationSource;
  timestamp: number;
  title: string;
  unread: boolean;
}

export type NotificationTab = "all" | "unread";

export function isNotificationUnread(
  item: AppNotification,
  readIds: ReadonlySet<string>
): boolean {
  return item.unread && !readIds.has(item.id);
}

export function countUnreadNotifications(
  items: readonly AppNotification[],
  readIds: ReadonlySet<string>
): number {
  return items.filter((item) => isNotificationUnread(item, readIds)).length;
}

export function visibleNotifications(
  items: readonly AppNotification[],
  tab: NotificationTab,
  readIds: ReadonlySet<string>
): AppNotification[] {
  if (tab === "all") {
    return [...items];
  }
  return items.filter((item) => isNotificationUnread(item, readIds));
}

/** The entry row's unread badge text: null when quiet, capped at "9+". */
export function notificationBadgeLabel(unreadCount: number): string | null {
  if (unreadCount <= 0) {
    return null;
  }
  return unreadCount > 9 ? "9+" : String(unreadCount);
}
