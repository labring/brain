import { createAreaReturnRoute } from "@/features/shell/area-return-route";

import { readPendingWorkspaceCreation } from "./workspace-creation-return";

/**
 * The Billing Area's return address: the close button returns to the in-app
 * route the user entered from. Only an internal path outside /billing
 * qualifies; anything else falls back to home. Wire `record` onto links that
 * navigate into /billing (the App Sidebar entries); a click while already
 * inside the Billing Area keeps the original entry point.
 *
 * Workspace Creation's Stripe Checkout Round-Trip voids the record: the
 * page arrives on `?stripeState=…&workspaceId=…` in the created Workspace,
 * and the recorded route belongs to the one the user left (spec §G.5), so
 * close lands on home rather than on a route from another Workspace. A
 * plan change's return stays in the same Workspace and keeps its entry
 * point. `read` is pure — it decides, but never mutates: the billing
 * workflow's Stripe-return effect spends the creation record and voids the
 * entry point once per arrival, and a cancel return keeps the entry point
 * (the user continues where they were) while still spending the record, so
 * a later plan change for that Workspace is never reworded as a creation.
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

/**
 * Whether the page is a Stripe *success* return of a Workspace this tab was
 * creating: the pending record's Workspace matches the URL's, and its pay
 * id is a non-empty match for the URL's — fail closed, so a record without
 * one (Desktop omitted it, or a legacy record) never rewords a later return
 * as a creation landing.
 */
function arrivedFromCreationLanding(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const query = new URLSearchParams(window.location.search);
  if (query.get("stripeState") !== "success") {
    return false;
  }
  const pending = readPendingWorkspaceCreation();
  const workspaceId = query.get("workspaceId");
  if (
    pending == null ||
    workspaceId == null ||
    pending.workspaceId !== workspaceId
  ) {
    return false;
  }
  const payId = query.get("payId");
  return pending.payId != null && pending.payId === payId;
}

export function readBillingReturnRoute(): string {
  return arrivedFromCreationLanding() ? "/" : billingReturnRoute.read();
}
