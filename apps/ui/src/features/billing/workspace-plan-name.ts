import { z } from "zod";

import { isDeletedSubscriptionRecord } from "./billing-plan-data";

const workspacePlanSubscriptionSchema = z.object({
  subscription: z.object({
    PlanName: z.string().optional(),
    Status: z.string().optional(),
    type: z.string().optional(),
  }),
});

/**
 * The plan name the Workspace Switcher shows for one
 * `workspace-subscription/info` payload (spec §C.5): the subscription's
 * plan, or null — shown as PAYG — when there is no subscription, the
 * record is deleted, or the payload is not a subscription at all. The
 * route handler and the billing Dev Mock share this one rule.
 */
export function workspacePlanNameFromSubscription(
  payload: unknown
): string | null {
  const parsed = workspacePlanSubscriptionSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const { PlanName, Status, type } = parsed.data.subscription;
  const planName = PlanName?.trim() ?? "";
  if (
    type === "PAYG" ||
    planName === "" ||
    isDeletedSubscriptionRecord(Status ?? "")
  ) {
    return null;
  }
  return planName;
}
