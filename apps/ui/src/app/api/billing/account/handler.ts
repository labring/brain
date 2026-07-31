import {
  type BillingProxyDependencies,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";

export function createBillingAccountHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    pathname: "/account/v1alpha1/account",
  });
}
