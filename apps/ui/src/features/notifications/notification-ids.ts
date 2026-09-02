import type { AppNotificationSource } from "@/features/shell/app-sidebar-notifications-model";

/** The `cr:` prefix every platform notification id carries. */
export const CR_NOTIFICATION_ID_PREFIX = "cr:";
/** The `db:` prefix every Brain-produced notification id carries. */
export const DB_NOTIFICATION_ID_PREFIX = "db:";

/**
 * A platform notification's id is versioned by the CR's own version (its
 * `spec.timestamp`, or its generation when upstream wrote none): the
 * platform overwrites fixed-name CRs in place on escalation, and the newer
 * version makes the revived message a new id that no old receipt covers.
 */
export function crNotificationId(name: string, version: number): string {
  return `${CR_NOTIFICATION_ID_PREFIX}${name}:${version}`;
}

export function dbNotificationId(messageId: string): string {
  return `${DB_NOTIFICATION_ID_PREFIX}${messageId}`;
}

export function notificationSource(id: string): AppNotificationSource | null {
  if (id.startsWith(CR_NOTIFICATION_ID_PREFIX)) {
    return "cr";
  }
  if (id.startsWith(DB_NOTIFICATION_ID_PREFIX)) {
    return "db";
  }
  return null;
}
