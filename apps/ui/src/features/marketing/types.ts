import { type RefinementCtx, z } from "zod";

const optionalText = z.string().trim().max(1024).default("");
const nullableId = z.string().trim().min(1).max(512).nullable();

export const MARKETING_CONSENT_STATES = [
  "granted",
  "denied",
  "unspecified",
] as const;

export type MarketingConsentState = (typeof MARKETING_CONSENT_STATES)[number];

const marketingConsentStateSchema = z.enum(MARKETING_CONSENT_STATES);

export function resolveMarketingConsentState(
  value: boolean | MarketingConsentState | null | undefined
): MarketingConsentState {
  if (value === true || value === "granted") {
    return "granted";
  }
  if (value === false || value === "denied") {
    return "denied";
  }
  return "unspecified";
}

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

const attributionFieldsSchema = z.object({
  ad_personalization: marketingConsentStateSchema.default("unspecified"),
  ad_user_data_consent: z.union([z.boolean(), marketingConsentStateSchema]),
  click_id_candidates: z.array(marketingTouchSchema).max(6).default([]),
  consent_provenance: z
    .object({
      issuer: z.string().trim().min(1).max(128),
      jti: z.string().trim().min(1).max(256),
      issued_at: z.string().datetime({ offset: true }),
      region: optionalText,
      source: z.literal("desktop_oauth"),
      subject_id: z.string().trim().min(1).max(512),
    })
    .strict()
    .nullable()
    .default(null),
  consent_token: z.string().trim().min(1).max(8192).optional(),
  attribution_raw: z.string().trim().min(1).max(16384).optional(),
  first_touch: marketingTouchSchema.nullable(),
  gbraid: z.string().trim().max(2048).nullable(),
  gclid: z.string().trim().max(2048).nullable(),
  last_touch: marketingTouchSchema.nullable(),
  wbraid: z.string().trim().max(2048).nullable(),
});

type AttributionValidationInput = z.infer<typeof attributionFieldsSchema>;

function hasClickId(attribution: AttributionValidationInput): boolean {
  return [
    attribution.gclid,
    attribution.gbraid,
    attribution.wbraid,
    ...attribution.click_id_candidates.map((touch) => touch.click_id_value),
    attribution.first_touch?.click_id_value,
    attribution.last_touch?.click_id_value,
  ].some(Boolean);
}

function addAttributionIssues(
  attribution: AttributionValidationInput,
  ctx: RefinementCtx,
  label: "attribution snapshot" | "event"
): void {
  const consentState = resolveMarketingConsentState(
    attribution.ad_user_data_consent
  );
  if (consentState !== "granted" && hasClickId(attribution)) {
    ctx.addIssue({
      code: "custom",
      message: `Google click IDs require granted ad user data consent for each ${label}.`,
    });
  }
}

export const marketingAttributionSnapshotSchema = z
  .object({
    ...attributionFieldsSchema.shape,
    version: z.union([z.literal(2), z.literal(3)]),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    addAttributionIssues(snapshot, ctx, "attribution snapshot");
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
    ...attributionFieldsSchema.shape,
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    deployment_id: nullableId,
    event_id: z.string().trim().min(1).max(512),
    event_name: z.enum(MARKETING_LIFECYCLE_EVENT_NAMES),
    hashed_user_data: hashedUserDataSchema.optional(),
    occurred_at: z.string().datetime({ offset: true }),
    transaction_id: z.string().trim().min(1).max(512).optional(),
    user_id: nullableId,
    value: z.number().finite().nonnegative().optional(),
    version: z.union([z.literal(2), z.literal(3)]).default(3),
    workspace_id: nullableId,
  })
  .strict()
  .superRefine((event, ctx) => {
    addAttributionIssues(event, ctx, "event");
    if (
      event.hashed_user_data &&
      resolveMarketingConsentState(event.ad_user_data_consent) !== "granted"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Hashed user data requires ad user data consent.",
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

export const MARKETING_EXTERNAL_LIFECYCLE_EVENT_NAMES = [
  "running_24h",
  "new_subscription",
  "topup_success",
] as const;

export const marketingExternalLifecycleEventInputSchema =
  marketingLifecycleEventInputSchema.superRefine((event, ctx) => {
    if (
      !(MARKETING_EXTERNAL_LIFECYCLE_EVENT_NAMES as readonly string[]).includes(
        event.event_name
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "External lifecycle producers may submit running_24h, new_subscription, or topup_success.",
        path: ["event_name"],
      });
    }
  });

export type MarketingLifecycleEventInput = z.infer<
  typeof marketingLifecycleEventInputSchema
>;
