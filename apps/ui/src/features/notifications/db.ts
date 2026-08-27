import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";

import { identityFingerprints } from "@/features/chat/persistence/schema";
import { getAppPostgresPool } from "@/lib/app-postgres/db";

import type { NotificationDbSchema, NotificationPgDatabase } from "./db-types";
import { notificationMessages, notificationReadReceipts } from "./schema";

const notificationSchema: NotificationDbSchema = {
  identityFingerprints,
  notificationMessages,
  notificationReadReceipts,
};

let notificationDbInstance: NotificationPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` (static analysis / route collection must not open the pool).
 */
export function getNotificationDb(): NotificationPgDatabase {
  notificationDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: notificationSchema,
  }) as NotificationPgDatabase;
  return notificationDbInstance;
}
