import {
  type BillingProxyDependencies,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";
import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";

export function createBillingAccountHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    pathname: BILLING_ROUTES.account.upstreamPathname,
  });
}
