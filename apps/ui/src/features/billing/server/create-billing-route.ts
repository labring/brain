import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import {
  type BillingProxyConfig,
  createAuthorizedBillingProxy,
} from "./authorized-proxy";
import type { BillingRouteEntry } from "./billing-route-table";

/**
 * Assembly layer for /api/billing/* routes: wires the real dependencies into
 * the authorized proxy and, in dev and demo builds, lets the billing dev-mock
 * dispatcher answer first. This is the only place production routing meets
 * the dev fixtures — the proxy itself knows nothing about mocking, and the
 * build-time-guarded dynamic import keeps fixtures out of real production
 * bundles (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image, same gate as the
 * dev tweaks panel).
 */

type BillingRouteHandler = (request: Request) => Promise<Response>;

/** Lets the dev-mock dispatcher answer for `handler` in dev/demo builds. */
export function withBillingDevMock(
  entry: BillingRouteEntry,
  handler: BillingRouteHandler
): BillingRouteHandler {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return handler;
  }
  return async (request) => {
    const { billingDevMockResponse } = await import("./dev-fixtures");
    const mocked = await billingDevMockResponse(
      entry.upstreamPathname,
      request
    );
    return mocked ?? handler(request);
  };
}

/** The standard billing route: authorized proxy + dev-mock interception. */
export function createBillingRoute(
  entry: BillingRouteEntry,
  config: Omit<BillingProxyConfig, "pathname"> = {}
): BillingRouteHandler {
  return withBillingDevMock(
    entry,
    createAuthorizedBillingProxy(
      { authorizeWorkspaceActor, requestAccountService },
      { ...config, pathname: entry.upstreamPathname }
    )
  );
}
