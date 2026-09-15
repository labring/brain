import { createAreaReturnRoute } from "@/features/shell/area-return-route";

import { isPendingWorkspaceCreation } from "./workspace-creation-return";

/**
 * The Billing Area's return address: the close button returns to the in-app
 * route the user entered from. Only an internal path outside /billing
 * qualifies; anything else falls back to home. Wire `record` onto links that
 * navigate into /billing (the App Sidebar entries); a click while already
 * inside the Billing Area keeps the original entry point.
 *
 * Workspace Creation's Stripe Checkout Round-Trip voids the record: the
 * page arrives on `?stripeState=…&workspaceId=…` in the created Workspace,
 * and the recorded route belongs to the one the user left (spec §G.5).
 * Reading through that arrival forgets the record, so the close button —
 * which reads once, during hydration — lands on home rather than on a
 * route from another Workspace. A plan change's return stays in the same
 * Workspace and keeps its entry point.
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

/** Whether the page is the Stripe return of a Workspace this tab created. */
function arrivedFromCreation(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const query = new URLSearchParams(window.location.search);
  const workspaceId = query.get("workspaceId");
  return (
    query.has("stripeState") &&
    workspaceId != null &&
    isPendingWorkspaceCreation(workspaceId)
  );
}

export function readBillingReturnRoute(): string {
  if (arrivedFromCreation()) {
    billingReturnRoute.clear();
    return "/";
  }
  return billingReturnRoute.read();
}
