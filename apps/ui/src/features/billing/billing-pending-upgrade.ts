import { z } from "zod";

export const INVALID_PENDING_UPGRADE_CODE = "invalid_pending_upgrade";
export const INVALID_PENDING_UPGRADE_MESSAGE =
  "The existing subscription payment could not be recovered.";
export const PENDING_SUBSCRIPTION_UPGRADE_MESSAGE =
  "An unpaid subscription upgrade already exists.";

const httpsUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => new URL(value).protocol === "https:");

const originalSubscriptionPlanSchema = z.object({
  period: z.string().trim().min(1),
  plan_name: z.string().trim().min(1),
  price: z.number().nonnegative(),
});

export const pendingSubscriptionUpgradeSchema = z.object({
  amount_due: z.number().nonnegative(),
  created_at: z.number().int().nonnegative(),
  currency: z.string().trim().min(1),
  discount_amount: z.number().nonnegative().optional(),
  has_discount: z.boolean().optional(),
  invoice_id: z.string().trim().min(1),
  original_amount: z.number().nonnegative().optional(),
  original_plan: originalSubscriptionPlanSchema.optional(),
  payment_id: z.string().trim().min(1),
  payment_url: httpsUrlSchema,
  plan_name: z.string().trim().min(1),
  promotion_code: z.string().trim().optional(),
  status: z.string().trim().min(1),
  total_amount: z.number().nonnegative().optional(),
});

export const pendingSubscriptionUpgradeErrorSchema = z.object({
  error: z.string().trim().min(1),
  pending_upgrade: pendingSubscriptionUpgradeSchema,
});

export const invalidPendingSubscriptionUpgradeErrorSchema = z.object({
  code: z.literal(INVALID_PENDING_UPGRADE_CODE),
  error: z.string().trim().min(1),
});

export type PendingSubscriptionUpgradePayload = z.infer<
  typeof pendingSubscriptionUpgradeSchema
>;
