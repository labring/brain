import { z } from "zod";

import {
  INVALID_PENDING_UPGRADE_CODE,
  INVALID_PENDING_UPGRADE_MESSAGE,
  PENDING_SUBSCRIPTION_UPGRADE_MESSAGE,
  pendingSubscriptionUpgradeSchema,
} from "@/features/billing/billing-pending-upgrade";
import { billingSubscriptionUpgradeAmountRequestSchema } from "@/features/billing/billing-request-schemas";
import {
  type BillingProxyDependencies,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";
import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";

const upstreamPendingSubscriptionUpgradeSchema = z.object({
  pending_upgrade: pendingSubscriptionUpgradeSchema,
});

function mapPendingSubscriptionUpgradeError(payload: unknown) {
  const parsed = upstreamPendingSubscriptionUpgradeSchema.safeParse(payload);
  if (parsed.success) {
    return {
      error: PENDING_SUBSCRIPTION_UPGRADE_MESSAGE,
      pending_upgrade: parsed.data.pending_upgrade,
    };
  }
  const hasPendingUpgrade =
    typeof payload === "object" &&
    payload != null &&
    Object.hasOwn(payload, "pending_upgrade");
  return hasPendingUpgrade
    ? {
        code: INVALID_PENDING_UPGRADE_CODE,
        error: INVALID_PENDING_UPGRADE_MESSAGE,
      }
    : null;
}

export function createBillingSubscriptionUpgradeAmountHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    mapAccountServiceError: mapPendingSubscriptionUpgradeError,
    pathname: BILLING_ROUTES.subscriptionUpgradeAmount.upstreamPathname,
    requestSchema: billingSubscriptionUpgradeAmountRequestSchema,
  });
}
