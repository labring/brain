/** The `db:` prefix every Brain-produced notification id carries. */
export const DB_NOTIFICATION_ID_PREFIX = "db:";

export function dbNotificationId(messageId: string): string {
  return `${DB_NOTIFICATION_ID_PREFIX}${messageId}`;
}
