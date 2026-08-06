import { z } from "zod";

const optionalText = z.string().trim().max(1024).default("");
const nullableId = z.string().trim().min(1).max(512).nullable();

export const marketingTouchSchema = z
  .object({
    campaign: optionalText,
    channel: optionalText,
    click_id_type: z.enum(["", "gclid", "gbraid", "wbraid"]),
    click_id_value: z.string().trim().max(2048),
    content: optionalText,
    landing_hostname: optionalText,
    landing_path: optionalText,
    medium: optionalText,
    source: optionalText,
    term: optionalText,
    ts: z.string().datetime({ offset: true }),
  })
  .strict();

export type MarketingTouch = z.infer<typeof marketingTouchSchema>;

export const marketingAttributionSnapshotSchema = z
  .object({
    ad_user_data_consent: z.boolean(),
    first_touch: marketingTouchSchema.nullable(),
    gbraid: z.string().trim().max(2048).nullable(),
    gclid: z.string().trim().max(2048).nullable(),
    last_touch: marketingTouchSchema.nullable(),
    version: z.literal(2),
    wbraid: z.string().trim().max(2048).nullable(),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    const clickIds = [snapshot.gclid, snapshot.gbraid, snapshot.wbraid].filter(
      Boolean
    );
    if (clickIds.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "Each attribution snapshot may contain one Google click ID.",
      });
    }
    const touchHasClickId = [snapshot.first_touch, snapshot.last_touch].some(
      (touch) => Boolean(touch?.click_id_value)
    );
    if (
      !snapshot.ad_user_data_consent &&
      (clickIds.length > 0 || touchHasClickId)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Google click IDs require ad user data consent.",
      });
    }
  });

export type MarketingAttributionSnapshot = z.infer<
  typeof marketingAttributionSnapshotSchema
>;

export const MARKETING_LIFECYCLE_EVENT_NAMES = [
  "build_started",
  "deploy_success",
  "running_24h",
  "new_subscription",
  "topup_success",
] as const;

export type MarketingLifecycleEventName =
  (typeof MARKETING_LIFECYCLE_EVENT_NAMES)[number];

const hashedUserDataSchema = z
  .object({
    email_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    phone_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict()
  .refine((value) => value.email_sha256 || value.phone_sha256, {
    message: "At least one hashed user identifier is required.",
  });

export const marketingLifecycleEventInputSchema = z
  .object({
    ad_user_data_consent: z.boolean(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    deployment_id: nullableId,
    event_id: z.string().trim().min(1).max(512),
    event_name: z.enum(MARKETING_LIFECYCLE_EVENT_NAMES),
    first_touch: marketingTouchSchema.nullable(),
    gbraid: z.string().trim().max(2048).nullable(),
    gclid: z.string().trim().max(2048).nullable(),
    hashed_user_data: hashedUserDataSchema.optional(),
    last_touch: marketingTouchSchema.nullable(),
    occurred_at: z.string().datetime({ offset: true }),
    transaction_id: z.string().trim().min(1).max(512).optional(),
    user_id: nullableId,
    value: z.number().finite().nonnegative().optional(),
    wbraid: z.string().trim().max(2048).nullable(),
    workspace_id: nullableId,
  })
  .strict()
  .superRefine((event, ctx) => {
    const clickIds = [event.gclid, event.gbraid, event.wbraid].filter(Boolean);
    if (clickIds.length > 1) {
      ctx.addIssue({
        code: "custom",
        message: "Each event may contain one Google click ID.",
      });
    }
    if (event.hashed_user_data && !event.ad_user_data_consent) {
      ctx.addIssue({
        code: "custom",
        message: "Hashed user data requires ad user data consent.",
      });
    }
    const touchHasClickId = [event.first_touch, event.last_touch].some(
      (touch) => Boolean(touch?.click_id_value)
    );
    if (
      !event.ad_user_data_consent &&
      (clickIds.length > 0 || touchHasClickId)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Google click IDs require ad user data consent.",
      });
    }
    if (
      event.event_name === "new_subscription" ||
      event.event_name === "topup_success"
    ) {
      for (const field of ["transaction_id", "currency", "value"] as const) {
        if (event[field] == null) {
          ctx.addIssue({
            code: "custom",
            message: `${field} is required for payment events.`,
            path: [field],
          });
        }
      }
    }
  });

export type MarketingLifecycleEventInput = z.infer<
  typeof marketingLifecycleEventInputSchema
>;
