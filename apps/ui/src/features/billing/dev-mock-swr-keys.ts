/**
 * Which SWR keys the billing Dev Mock owns. Switching a Mock Scenario
 * revalidates exactly these — every surface whose answers the fixtures
 * shape (Billing Area, the sidebar subscription badge, the Notification
 * Center's Brain feed and account facts, the Status Hint, the chat
 * free-turn count) — and nothing else. A blanket `mutate(() => true)` used
 * to refire every key on the page; with the cluster unreachable those
 * requests hang, saturate the browser's per-host connection pool, and
 * queue the mock's own refetches behind them.
 */
export const BILLING_DEV_MOCK_SWR_KEY_PREFIXES = [
  "billing-",
  "app-sidebar-subscription",
  "notifications-",
  "status-hint-",
  "chat-free-turns",
] as const;

/** SWR `mutate` filter: true for keys the billing Dev Mock's fixtures shape. */
export function isBillingDevMockSwrKey(key: unknown): boolean {
  const head = Array.isArray(key) ? key[0] : key;
  return (
    typeof head === "string" &&
    BILLING_DEV_MOCK_SWR_KEY_PREFIXES.some((prefix) => head.startsWith(prefix))
  );
}
