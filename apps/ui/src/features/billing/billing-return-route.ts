const BILLING_RETURN_ROUTE_STORAGE_KEY = "billing-return-route";

/**
 * The Billing Area close button returns to the in-app route the user entered
 * from. Only an internal path outside /billing qualifies; anything else
 * (deep link entry, cleared storage, tampered value) falls back to home.
 */
export function sanitizeBillingReturnRoute(raw: string | null): string {
  if (
    raw?.startsWith("/") &&
    !raw.startsWith("//") &&
    !raw.startsWith("/billing")
  ) {
    return raw;
  }
  return "/";
}

/**
 * Records the current route as the Billing Area entry point. Wire this onto
 * links that navigate into /billing (the App Sidebar entries); a click while
 * already inside the Billing Area keeps the original entry point.
 */
export function recordBillingReturnRoute(): void {
  if (typeof window === "undefined") {
    return;
  }
  const route = `${window.location.pathname}${window.location.search}`;
  if (route.startsWith("/billing")) {
    return;
  }
  try {
    window.sessionStorage.setItem(BILLING_RETURN_ROUTE_STORAGE_KEY, route);
  } catch {
    // Storage can be unavailable (private browsing); close falls back to home.
  }
}

export function readBillingReturnRoute(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  try {
    return sanitizeBillingReturnRoute(
      window.sessionStorage.getItem(BILLING_RETURN_ROUTE_STORAGE_KEY)
    );
  } catch {
    return "/";
  }
}
