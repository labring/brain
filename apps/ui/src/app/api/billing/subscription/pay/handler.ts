import { z } from "zod";

import {
  type BillingProxyDependencies,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";

const subscriptionRequestFields = {
  payMethod: z.enum(["stripe", "balance"]),
  planName: z.string().trim().min(1),
  regionDomain: z.string().trim().min(1),
  workspace: z.string().trim().min(1),
};

const subscriptionPayRequestSchema = z.discriminatedUnion("operator", [
  z.object({
    ...subscriptionRequestFields,
    operator: z.enum(["canceled", "resumed"]),
  }),
  z.object({
    ...subscriptionRequestFields,
    cardId: z.string().trim().min(1).optional(),
    operator: z.enum(["created", "upgraded", "downgraded", "renewed"]),
    period: z.enum(["1m", "1y"]),
    promotionCode: z.string().trim().min(1).optional(),
  }),
]);

function addBrainPayApp(data: unknown) {
  const request = subscriptionPayRequestSchema.parse(data);
  return { ...request, payApp: "system-brain" };
}

export function createBillingSubscriptionPayHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    invalidRequestMessage: "Invalid subscription payment request.",
    mapRequestBody: addBrainPayApp,
    pathname: "/account/v1alpha1/workspace-subscription/pay",
    requestSchema: subscriptionPayRequestSchema,
  });
}
