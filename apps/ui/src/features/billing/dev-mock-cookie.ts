/**
 * Cookie protocol shared by the billing dev-mock panel (client) and the
 * fixture dispatcher (server). The session cookie is the single source of
 * truth for mock state — there is no env var and no localStorage copy.
 *
 * Value grammar: `<scenario>` while the mock is on, `off:<scenario>` while it
 * is off (the scenario part keeps the last selection so the panel can restore
 * it). Anything else is invalid and makes the server answer 500 so typos fail
 * loud instead of silently serving real data.
 */

export const BILLING_DEV_MOCK_COOKIE = "sealai-billing-dev-mock";

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
  "deleted",
  "status-unknown",
  "mixed-workspaces",
] as const;

export type BillingDevScenario = (typeof BILLING_DEV_SCENARIOS)[number];

export const DEFAULT_BILLING_DEV_SCENARIO: BillingDevScenario = "active";

export interface BillingDevMockState {
  enabled: boolean;
  scenario: BillingDevScenario;
}

const OFF_PREFIX = "off:";

export function isBillingDevScenario(
  value: string
): value is BillingDevScenario {
  return (BILLING_DEV_SCENARIOS as readonly string[]).includes(value);
}

export function formatBillingDevMockCookie(state: BillingDevMockState): string {
  return state.enabled ? state.scenario : `${OFF_PREFIX}${state.scenario}`;
}

export type ParsedBillingDevMockCookie =
  | { kind: "invalid"; raw: string }
  | { kind: "set"; state: BillingDevMockState }
  | { kind: "unset" };

export function parseBillingDevMockCookie(
  raw: string | null | undefined
): ParsedBillingDevMockCookie {
  const value = raw?.trim() ?? "";
  if (value === "") {
    return { kind: "unset" };
  }
  if (value.startsWith(OFF_PREFIX)) {
    const scenario = value.slice(OFF_PREFIX.length);
    return {
      kind: "set",
      state: {
        enabled: false,
        scenario: isBillingDevScenario(scenario)
          ? scenario
          : DEFAULT_BILLING_DEV_SCENARIO,
      },
    };
  }
  if (isBillingDevScenario(value)) {
    return { kind: "set", state: { enabled: true, scenario: value } };
  }
  return { kind: "invalid", raw: value };
}
