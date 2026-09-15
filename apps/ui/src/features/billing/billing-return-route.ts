import { createAreaReturnRoute } from "@/features/shell/area-return-route";

/**
 * The Billing Area's return address: the close button returns to the in-app
 * route the user entered from. Only an internal path outside /billing
 * qualifies; anything else falls back to home. Wire `record` onto links that
 * navigate into /billing (the App Sidebar entries); a click while already
 * inside the Billing Area keeps the original entry point.
 */
const billingReturnRoute = createAreaReturnRoute({
  prefix: "/billing",
  storageKey: "billing-return-route",
});

export function sanitizeBillingReturnRoute(raw: string | null): string {
  return billingReturnRoute.sanitize(raw);
}

export function recordBillingReturnRoute(): void {
  billingReturnRoute.record();
}

export function readBillingReturnRoute(): string {
  return billingReturnRoute.read();
}
