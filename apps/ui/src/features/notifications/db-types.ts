import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { identityFingerprints } from "@/features/chat/persistence/schema";

import type { notificationMessages, notificationReadReceipts } from "./schema";

// biome-ignore lint/style/useConsistentTypeDefinitions: interfaces lack the implicit index signature PgDatabase's schema generic requires
export type NotificationDbSchema = {
  identityFingerprints: typeof identityFingerprints;
  notificationMessages: typeof notificationMessages;
  notificationReadReceipts: typeof notificationReadReceipts;
};

/**
 * Driver-agnostic database type shared by production (node-postgres) and the
 * PGlite tests; the store constrains itself to the query-builder surface
 * every drizzle pg driver provides. `identityFingerprints` rides along
 * because receipt writes re-check the binding in-transaction (ADR-0059).
 */
export type NotificationPgDatabase = PgDatabase<
  PgQueryResultHKT,
  NotificationDbSchema
>;
