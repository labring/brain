import { z } from "zod";

import { workspaceResourceQuotaSnapshotSchema } from "@/features/billing/workspace-resource-quota";

/**
 * The Brain-produced Notification kinds (`db:` stream). Each kind's payload
 * carries the structured parameters the display layer renders; strings never
 * cross the wire. The first producer is `quota-exhausted`; the gift hint and
 * subscription-change receipt follow in later tickets.
 */
export const NOTIFICATION_MESSAGE_KINDS = ["quota-exhausted"] as const;

export type NotificationMessageKind =
  (typeof NOTIFICATION_MESSAGE_KINDS)[number];

/** The five workspace quota resources a `quota-exhausted` entry can name. */
export const QUOTA_EXHAUSTED_RESOURCES = [
  "cpu",
  "memory",
  "storage",
  "pod",
  "nodeport",
] as const;

export type QuotaExhaustedResource = (typeof QUOTA_EXHAUSTED_RESOURCES)[number];

export const quotaExhaustedPayloadSchema = z
  .object({
    kind: z.literal("quota-exhausted"),
    resource: z.enum(QUOTA_EXHAUSTED_RESOURCES),
    /** Snapshot at the crossing, in the quota item's native unit. */
    limit: z.number().finite().nonnegative(),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export const notificationPayloadSchema = z.discriminatedUnion("kind", [
  quotaExhaustedPayloadSchema,
]);

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

/** The `db:` stream's wire shape (`GET /api/notifications`). */
export const notificationMessageSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(NOTIFICATION_MESSAGE_KINDS),
    /** Unix epoch milliseconds. */
    createdAt: z.number().int().nonnegative(),
    payload: notificationPayloadSchema,
    projectUid: z.string().nullable(),
  })
  .strict();

export type NotificationMessage = z.infer<typeof notificationMessageSchema>;

export const notificationFeedResponseSchema = z
  .object({
    messages: z.array(notificationMessageSchema),
    /** Source-prefixed notification ids the current user has read. */
    receipts: z.array(z.string().min(1)),
  })
  .strict();

export type NotificationFeedResponse = z.infer<
  typeof notificationFeedResponseSchema
>;

/** A notification id is source-prefixed: `cr:<name>:<timestamp>` or `db:<id>`. */
export const NOTIFICATION_ID_PATTERN = /^(cr|db):.+$/;

export const markNotificationReadRequestSchema = z
  .object({
    ids: z.array(z.string().regex(NOTIFICATION_ID_PATTERN)).min(1).max(200),
  })
  .strict();

export type MarkNotificationReadRequest = z.infer<
  typeof markNotificationReadRequestSchema
>;

export const quotaObservationRequestSchema = z
  .object({
    quota: workspaceResourceQuotaSnapshotSchema,
  })
  .strict();

export type QuotaObservationRequest = z.infer<
  typeof quotaObservationRequestSchema
>;
