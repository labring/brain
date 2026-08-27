import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import { requireCurrentIdentityBinding } from "@/lib/identity-fingerprint-core";
import { DAY_MS } from "@/lib/time";

import type { NotificationPgDatabase } from "./db-types";
import { DB_NOTIFICATION_ID_PREFIX } from "./notification-ids";
import {
  NOTIFICATION_RETENTION_DAYS,
  type NotificationMessageRow,
  notificationMessages,
  notificationReadReceipts,
} from "./schema";
import type {
  NotificationMessage,
  NotificationMessageKind,
  NotificationPayload,
} from "./types";

type ReceiptInsert = typeof notificationReadReceipts.$inferInsert;

/**
 * The reader marking notifications read: bare uid key + crName for the
 * re-check, plus the workspace whose `db:` rows the receipts may attach to.
 */
export interface NotificationReader {
  legacyWorkspaceActor: string;
  namespace: string;
  userUid: string;
}

export interface ProduceNotificationInput {
  dedupeKey: string;
  kind: NotificationMessageKind;
  namespace: string;
  /** Injection seam for the sweep's clock; defaults to now. */
  now?: Date;
  payload: NotificationPayload;
  projectUid?: string | null;
}

export interface NotificationStore {
  /** The namespace's entries, newest first. */
  listMessages(namespace: string): Promise<NotificationMessage[]>;
  /** The user's receipts, as source-prefixed ids. */
  listReceipts(userUid: string): Promise<string[]>;
  /**
   * Records receipts for the given source-prefixed ids. `db:` ids attach the
   * message row so the sweep cascades; unknown or foreign `db:` ids are
   * ignored rather than refused. Idempotent.
   */
  markRead(reader: NotificationReader, ids: readonly string[]): Promise<void>;
  /**
   * Edge-triggered write: inserts one entry unless a live row already holds
   * the dedupe key, in which case nothing is written (retries are idempotent
   * by naming). Every write also sweeps entries older than the retention
   * window — no scheduler. Returns whether a row was inserted.
   */
  produce(input: ProduceNotificationInput): Promise<boolean>;
  /**
   * Recovery: frees the dedupe key so the next threshold crossing writes a
   * fresh entry. The released row stays as history. Returns whether a live
   * row was released.
   */
  release(input: { dedupeKey: string; now?: Date }): Promise<boolean>;
}

/**
 * `db:` receipts attach their message row so the sweep cascades; a `db:` id
 * this namespace does not hold is skipped (it would outlive nothing). Every
 * other id is a platform key and stands alone.
 */
function receiptRows(
  keys: readonly string[],
  ownedMessageIds: ReadonlySet<string>,
  reader: NotificationReader
): ReceiptInsert[] {
  const rows: ReceiptInsert[] = [];
  for (const key of keys) {
    const isDbKey = key.startsWith(DB_NOTIFICATION_ID_PREFIX);
    const messageId = isDbKey
      ? key.slice(DB_NOTIFICATION_ID_PREFIX.length)
      : null;
    if (isDbKey && !(messageId != null && ownedMessageIds.has(messageId))) {
      continue;
    }
    rows.push({ messageId, messageKey: key, userUid: reader.userUid });
  }
  return rows;
}

function toMessage(row: NotificationMessageRow): NotificationMessage {
  return {
    createdAt: row.createdAt.getTime(),
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    projectUid: row.projectUid,
  };
}

/**
 * Persistence for the Notification Center's Brain-produced stream and read
 * receipts (ADR-0067). The handle's schema carries `identity_fingerprints`
 * too: receipt writes must span the binding re-check (ADR-0059).
 */
export function createNotificationStore(
  getDb: () => NotificationPgDatabase
): NotificationStore {
  return {
    listMessages: async (namespace) => {
      const rows = await getDb()
        .select()
        .from(notificationMessages)
        .where(eq(notificationMessages.namespace, namespace))
        .orderBy(
          desc(notificationMessages.createdAt),
          desc(notificationMessages.id)
        );
      return rows.map(toMessage);
    },
    listReceipts: async (userUid) => {
      const rows = await getDb()
        .select({ messageKey: notificationReadReceipts.messageKey })
        .from(notificationReadReceipts)
        .where(eq(notificationReadReceipts.userUid, userUid));
      return rows.map((row) => row.messageKey);
    },
    markRead: (reader, ids) =>
      getDb().transaction(async (tx) => {
        const keys = [...new Set(ids)];
        if (keys.length === 0) {
          return;
        }
        // Receipts are uid-keyed rows: re-check the fingerprint in the same
        // transaction so a concurrent merge either sweeps them or refuses
        // the stale binding (ADR-0059).
        await requireCurrentIdentityBinding(tx, {
          crName: reader.legacyWorkspaceActor,
          userUid: reader.userUid,
        });
        const dbIds = keys
          .filter((key) => key.startsWith(DB_NOTIFICATION_ID_PREFIX))
          .map((key) => key.slice(DB_NOTIFICATION_ID_PREFIX.length));
        const owned =
          dbIds.length === 0
            ? []
            : await tx
                .select({ id: notificationMessages.id })
                .from(notificationMessages)
                .where(
                  and(
                    eq(notificationMessages.namespace, reader.namespace),
                    inArray(notificationMessages.id, dbIds)
                  )
                );
        const ownedIds = new Set(owned.map((row) => row.id));
        const values = receiptRows(keys, ownedIds, reader);
        if (values.length === 0) {
          return;
        }
        await tx
          .insert(notificationReadReceipts)
          .values(values)
          .onConflictDoNothing({
            target: [
              notificationReadReceipts.userUid,
              notificationReadReceipts.messageKey,
            ],
          });
      }),
    produce: (input) =>
      getDb().transaction(async (tx) => {
        const now = input.now ?? new Date();
        const inserted = await tx
          .insert(notificationMessages)
          .values({
            createdAt: now,
            dedupeKey: input.dedupeKey,
            id: randomUUID(),
            kind: input.kind,
            namespace: input.namespace,
            payload: input.payload,
            projectUid: input.projectUid ?? null,
          })
          .onConflictDoNothing({
            target: notificationMessages.dedupeKey,
            where: sql`${notificationMessages.releasedAt} IS NULL`,
          })
          .returning({ id: notificationMessages.id });
        // Retention is enforced here, on the write path, so the table never
        // needs a scheduler; receipts on swept rows cascade.
        await tx
          .delete(notificationMessages)
          .where(
            lt(
              notificationMessages.createdAt,
              new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS)
            )
          );
        return inserted.length > 0;
      }),
    release: async (input) => {
      const released = await getDb()
        .update(notificationMessages)
        .set({ releasedAt: input.now ?? new Date() })
        .where(
          and(
            eq(notificationMessages.dedupeKey, input.dedupeKey),
            isNull(notificationMessages.releasedAt)
          )
        )
        .returning({ id: notificationMessages.id });
      return released.length > 0;
    },
  };
}
