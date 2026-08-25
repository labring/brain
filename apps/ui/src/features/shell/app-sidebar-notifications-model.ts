/**
 * The Notification Center's model: what one Notification is, plus the pure
 * derivations the panel renders from (unread accounting, tab filtering, the
 * entry badge). No data source is wired yet — items arrive via the
 * notifications store, which only the dev mock writes today.
 */

export type AppNotificationKind =
  | "announcement"
  | "billing"
  | "deploy-failure"
  | "deploy-success"
  | "quota";

/**
 * One Notification: a message addressed to the current user, aggregated
 * across Projects. `time` is a preformatted display string until a real
 * data source lands; `unread` is the item's own state before session read
 * receipts are applied on top.
 */
export interface AppNotification {
  id: string;
  kind: AppNotificationKind;
  project?: string;
  time: string;
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
