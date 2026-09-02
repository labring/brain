import {
  type DevMockState,
  defineDevMockCookie,
  type ParsedDevMockCookie,
} from "@/features/dev-mock/cookie";

/**
 * The billing Dev Mock's cookie (grammar in `features/dev-mock/cookie.ts`).
 * One scenario shapes every `/api/billing/*` answer, the billing-born
 * Notifications, and through them the Status Hint and Chat Billing Mode.
 */

export const BILLING_DEV_SCENARIOS = [
  "payg",
  "payg-debt",
  "payg-debt-deletion",
  "payg-debt-final",
  "free",
  "free-expiring",
  "free-expired",
  "paused",
  "active",
  "active-balance",
  "cancelling",
  "payment-due",
  "payment-due-deletion",
  "payment-due-final",
  "pending-upgrade",
  "quota-full",
  "ai-credits-exhausted",
  "deleted",
  "status-unknown",
  "mixed-workspaces",
] as const;

export type BillingDevScenario = (typeof BILLING_DEV_SCENARIOS)[number];

export const DEFAULT_BILLING_DEV_SCENARIO: BillingDevScenario = "active";

export const billingDevMockCookie = defineDevMockCookie<BillingDevScenario>({
  defaultScenario: DEFAULT_BILLING_DEV_SCENARIO,
  name: "sealai-billing-dev-mock",
  scenarios: BILLING_DEV_SCENARIOS,
});

export const BILLING_DEV_MOCK_COOKIE = billingDevMockCookie.name;

export type BillingDevMockState = DevMockState<BillingDevScenario>;

export type ParsedBillingDevMockCookie =
  ParsedDevMockCookie<BillingDevScenario>;

export function isBillingDevScenario(
  value: string
): value is BillingDevScenario {
  return billingDevMockCookie.is(value);
}

export function formatBillingDevMockCookie(state: BillingDevMockState): string {
  return billingDevMockCookie.format(state);
}

export function parseBillingDevMockCookie(
  raw: string | null | undefined
): ParsedBillingDevMockCookie {
  return billingDevMockCookie.parse(raw);
}
