/**
 * The Notification Center's model: what one Notification is, plus the pure
 * derivations the panel renders from (unread accounting, tab filtering, the
 * entry badge). Items arrive from the merged feed
 * (`@/features/notifications/feed-model`): platform CRs read live from the
 * cluster and Brain-produced entries from Brain's own store, one list sorted
 * by real time.
 */

/**
 * Notification Severity: how much the message matters, derived from what it
 * is about — critical (already suspended or facing deletion), warning (a
 * threshold crossed or a deadline near; action prevents the next stage),
 * info (a receipt, a hint, an announcement). Shown without escalation.
 */
export type NotificationSeverity = "critical" | "warning" | "info";

/** Which stream a Notification came from; also its id prefix. */
export type AppNotificationSource = "cr" | "db";

/**
 * The one way out a Notification offers (design spec §10 rule 6): a verb
 * from the CTA table deep-linking to the page that solves the problem.
 * Receipts and hints carry none.
 */
export interface NotificationCTA {
  href: string;
  label: string;
}

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
  cta?: NotificationCTA;
  id: string;
  project?: string;
  severity: NotificationSeverity;
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
