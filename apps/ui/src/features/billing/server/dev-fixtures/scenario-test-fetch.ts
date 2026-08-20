import type { BillingFetch } from "../../billing-data-client";
import { BILLING_DEV_MOCK_COOKIE } from "../../dev-mock-cookie";
import { BILLING_ROUTES } from "../billing-route-table";
import { billingDevMockResponse } from "./index";

/**
 * Test-only: a BillingFetch that answers every /api/billing/* route from the
 * dev-mock fixtures of one pinned scenario, exactly as the route handlers
 * would. Fixture-driven tests (loader derivations, surface renders) share
 * this so they exercise the same pipeline the browser does.
 */

const ROUTE_TO_UPSTREAM = new Map<string, string>(
  Object.values(BILLING_ROUTES).map((entry) => [
    entry.apiPath,
    entry.upstreamPathname,
  ])
);

function requestPathname(input: Parameters<BillingFetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.pathname;
  }
  return new URL(input.url, "http://localhost").pathname;
}

export function scenarioTestFetch(scenario: string): BillingFetch {
  return async (input, init) => {
    const pathname = requestPathname(input);
    const upstream = ROUTE_TO_UPSTREAM.get(pathname);
    if (upstream == null) {
      throw new Error(`route ${pathname} has no upstream mapping`);
    }
    const request = new Request(
      new URL(pathname, "http://localhost"),
      init ?? undefined
    );
    request.headers.set("cookie", `${BILLING_DEV_MOCK_COOKIE}=${scenario}`);
    const response = await billingDevMockResponse(upstream, request);
    if (response == null) {
      throw new Error("mock mode did not answer the request");
    }
    return response;
  };
}
