import { z } from "zod";

import {
  type BillingProxyDependencies,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";

const subscriptionLifecycleRequestSchema = z.object({
  operator: z.enum(["canceled", "resumed"]),
  payMethod: z.enum(["stripe", "balance"]),
  planName: z.string().trim().min(1),
  regionDomain: z.string().trim().min(1),
  workspace: z.string().trim().min(1),
});

function addBrainPayApp(data: unknown) {
  const request = subscriptionLifecycleRequestSchema.parse(data);
  return { ...request, payApp: "system-brain" };
}

export function createBillingSubscriptionPayHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    invalidRequestMessage: "Invalid subscription payment request.",
    mapRequestBody: addBrainPayApp,
    pathname: "/account/v1alpha1/workspace-subscription/pay",
    requestSchema: subscriptionLifecycleRequestSchema,
  });
}
