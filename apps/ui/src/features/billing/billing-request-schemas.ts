import { z } from "zod";

export const billingWorkspaceRequestSchema = z.object({
  regionDomain: z.string().trim().min(1),
  workspace: z.string().trim().min(1),
});

export const billingWorkspaceQuotaRequestSchema = z.object({
  workspace: z.string().trim().min(1),
});

export const billingSubscriptionUpgradeAmountRequestSchema =
  billingWorkspaceRequestSchema.extend({
    operator: z.enum(["created", "upgraded"]),
    payMethod: z.literal("stripe"),
    period: z.enum(["1m", "1y"]),
    planName: z.string().trim().min(1),
    promotionCode: z.string().trim().min(1).optional(),
  });

export const billingSubscriptionInvoiceCancelRequestSchema =
  billingWorkspaceRequestSchema.extend({
    invoiceID: z.string().trim().min(1),
  });

export const billingTimeRangeRequestSchema = z.object({
  endTime: z.iso.datetime(),
  startTime: z.iso.datetime(),
});
