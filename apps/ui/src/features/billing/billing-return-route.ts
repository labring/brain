import { createAreaReturnRoute } from "@/features/shell/area-return-route";

/**
 * The Billing Area's return address: the close button returns to the in-app
 * route the user entered from. Only an internal path outside /billing
 * qualifies; anything else falls back to home. Wire `record` onto links that
 * navigate into /billing (the App Sidebar entries); a click while already
 * inside the Billing Area keeps the original entry point.
 *
 * A Stripe Checkout Round-Trip voids the record: the page arrives on
 * `?stripeState=…` from outside, and after Workspace Creation the recorded
 * route belongs to the Workspace the user left (spec §G.5). Reading through
 * that arrival forgets the record, so the close button — which reads once,
 * during hydration — lands on home rather than on a route from another
 * Workspace.
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

export function clearBillingReturnRoute(): void {
  billingReturnRoute.clear();
}

const STRIPE_RETURN_PARAMETER = "stripeState";

function arrivedFromStripe(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return new URLSearchParams(window.location.search).has(
    STRIPE_RETURN_PARAMETER
  );
}

export function readBillingReturnRoute(): string {
  if (arrivedFromStripe()) {
    billingReturnRoute.clear();
    return "/";
  }
  return billingReturnRoute.read();
}
