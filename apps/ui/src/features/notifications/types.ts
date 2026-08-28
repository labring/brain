import type { NotificationCRItem } from "@workspace/api/hooks";
import { z } from "zod";

import { workspaceResourceQuotaSnapshotSchema } from "@/features/billing/workspace-resource-quota";

/**
 * The Brain-produced Notification kinds (`db:` stream). Each kind's payload
 * carries the structured parameters the display layer renders; strings never
 * cross the wire. Catalog rows A1 (quota exhausted), D4 (the $1 gift hint),
 * and B5 (subscription-change receipts).
 */
export const NOTIFICATION_MESSAGE_KINDS = [
  "quota-exhausted",
  "credit-hint",
  "subscription-change",
] as const;

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

/** ISO-8601 instant; the display layer renders it as an absolute date. */
const isoInstantSchema = z.string().datetime({ offset: true });

export const creditHintPayloadSchema = z
  .object({
    kind: z.literal("credit-hint"),
    /**
     * Gift expiry. Upstream's credits/info carries no per-row expiry today,
     * so live entries omit it and the copy states the one-month validity;
     * the renderer already speaks the dated form for when it lands.
     */
    expiresAt: isoInstantSchema.optional(),
    /** Remaining gift at first visibility, in micro-units. */
    giftMicroUnits: z.number().finite().nonnegative(),
  })
  .strict();

export const SUBSCRIPTION_CHANGES = [
  "upgraded",
  "downgraded",
  "cancelled",
] as const;

export type SubscriptionChange = (typeof SUBSCRIPTION_CHANGES)[number];

export const subscriptionChangePayloadSchema = z
  .object({
    kind: z.literal("subscription-change"),
    change: z.enum(SUBSCRIPTION_CHANGES),
    /** When a scheduled change lands (a downgrade or cancellation at period end). */
    effectiveAt: isoInstantSchema.optional(),
    planName: z.string().trim().min(1).max(64),
  })
  .strict();

export const notificationPayloadSchema = z.discriminatedUnion("kind", [
  quotaExhaustedPayloadSchema,
  creditHintPayloadSchema,
  subscriptionChangePayloadSchema,
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

/**
 * One upstream Notification CR as the Go read proxy flattens it — pinned to
 * `NotificationCRItem` from `@workspace/api/hooks` so the two cannot drift;
 * only the dev fixtures ever send it over Brain's own wire.
 */
export const notificationCRItemSchema = z
  .object({
    creationTimestamp: z.string().optional(),
    desktopPopup: z.boolean(),
    from: z.string().optional(),
    importance: z.string().optional(),
    isRead: z.boolean(),
    message: z.string(),
    name: z.string().min(1),
    namespace: z.string(),
    /** `spec.timestamp` in Unix seconds. */
    timestamp: z.number().int().nonnegative(),
    title: z.string(),
    uid: z.string().optional(),
    /** The id's version component (see `NotificationCRItem.version`). */
    version: z.number().int().nonnegative(),
  })
  .strict() satisfies z.ZodType<NotificationCRItem>;

export const notificationFeedResponseSchema = z
  .object({
    messages: z.array(notificationMessageSchema),
    /**
     * Fixture platform CRs, present only while the billing Dev Mock serves
     * the feed: the client then takes them as the `cr:` stream instead of
     * polling the cluster. Production never sends the field.
     */
    platformItems: z.array(notificationCRItemSchema).optional(),
    /** Source-prefixed notification ids the current user has read. */
    receipts: z.array(z.string().min(1)),
  })
  .strict();

export type NotificationFeedResponse = z.infer<
  typeof notificationFeedResponseSchema
>;

/** A notification id is source-prefixed: `cr:<name>:<timestamp>` or `db:<id>`. */
export const NOTIFICATION_ID_PATTERN = /^(cr|db):.+$/;

/** Ids per mark-read request; the client splits larger batches. */
export const NOTIFICATION_READ_BATCH_LIMIT = 200;

export const markNotificationReadRequestSchema = z
  .object({
    ids: z
      .array(z.string().regex(NOTIFICATION_ID_PATTERN))
      .min(1)
      .max(NOTIFICATION_READ_BATCH_LIMIT),
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

/** `POST /api/notifications/gift-observation`: the credits the client just read. */
export const giftObservationRequestSchema = z
  .object({
    giftMicroUnits: z.number().finite().nonnegative(),
  })
  .strict();

export type GiftObservationRequest = z.infer<
  typeof giftObservationRequestSchema
>;

/**
 * `POST /api/notifications/subscription-change`: a change the client saw
 * settle, identified by the platform's transaction id.
 */
export const subscriptionChangeObservationRequestSchema = z
  .object({
    change: z.enum(SUBSCRIPTION_CHANGES),
    effectiveAt: isoInstantSchema.optional(),
    planName: z.string().trim().min(1).max(64),
    transactionId: z.string().trim().min(1).max(128),
  })
  .strict();

export type SubscriptionChangeObservationRequest = z.infer<
  typeof subscriptionChangeObservationRequestSchema
>;
