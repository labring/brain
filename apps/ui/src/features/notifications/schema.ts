import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { NotificationMessageKind, NotificationPayload } from "./types";

/**
 * Postgres schema owning the Notification Center's Brain-produced stream and
 * the per-user read receipts (ADR-0067). Platform messages never land here:
 * they stay in the cluster as Notification CRs and are read live. Isolated
 * from `public` like every other app-owned schema.
 */
export const NOTIFICATION_DB_SCHEMA = "sealai_notification";

export const ns = pgSchema(NOTIFICATION_DB_SCHEMA);

/** Brain-produced entries are kept this long; swept opportunistically on write. */
export const NOTIFICATION_RETENTION_DAYS = 365;

/**
 * One Brain-produced Notification (`db:` stream). Rendering stays client-side:
 * `payload` carries the structured parameters the display layer turns into
 * copy, never final strings. `dedupeKey` is the producer's idempotency key —
 * naming is dedupe, so a retried request re-inserts nothing. A producer
 * "releases" the key (`releasedAt`) when the underlying state recovers so the
 * next threshold crossing writes a fresh entry while history keeps the old
 * one; the unique index therefore only spans live keys.
 */
export const notificationMessages = ns.table(
  "notification_messages",
  {
    id: text("id").primaryKey(),
    /** Workspace namespace; the inbox's aggregation boundary. */
    namespace: text("namespace").notNull(),
    kind: text("kind").notNull().$type<NotificationMessageKind>(),
    /** Source Project when the message has one (deploy outcomes, later). */
    projectUid: text("project_uid"),
    payload: jsonb("payload").notNull().$type<NotificationPayload>(),
    dedupeKey: text("dedupe_key").notNull(),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_messages_live_dedupe_key_idx")
      .on(table.dedupeKey)
      .where(sql`${table.releasedAt} IS NULL`),
    index("notification_messages_namespace_created_at_idx").on(
      table.namespace,
      table.createdAt
    ),
    index("notification_messages_created_at_idx").on(table.createdAt),
  ]
);

/**
 * One read receipt per user × workspace × message key. The key is the
 * source-prefixed notification id: `db:<message id>` for Brain-produced
 * entries (with `messageId` set so the 365-day sweep cascades) and
 * `cr:<name>:<timestamp>` for platform CRs — versioned by the CR's own
 * timestamp so an upstream revive (same fixed name, newer timestamp) reads as
 * unread again. Any role writes receipts; the CR label is a separate,
 * best-effort write.
 */
export const notificationReadReceipts = ns.table(
  "notification_read_receipts",
  {
    /** Bare global user UID (ADR-0059). */
    userUid: text("user_uid").notNull(),
    namespace: text("namespace").notNull(),
    messageKey: text("message_key").notNull(),
    messageId: text("message_id").references(() => notificationMessages.id, {
      onDelete: "cascade",
    }),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.userUid, table.namespace, table.messageKey],
    }),
    index("notification_read_receipts_message_id_idx").on(table.messageId),
  ]
);

export type NotificationMessageRow = typeof notificationMessages.$inferSelect;
export type NotificationReadReceiptRow =
  typeof notificationReadReceipts.$inferSelect;
