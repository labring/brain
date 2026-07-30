export const BILLING_CURRENCIES = ["usd", "cny", "shellCoin"] as const;

export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];
export type BillingEnv = Record<string, string | undefined>;

const DEFAULT_BILLING_CURRENCY: BillingCurrency = "usd";

function isBillingCurrency(value: string): value is BillingCurrency {
  return BILLING_CURRENCIES.some((currency) => currency === value);
}

export function getBillingCurrencyFromEnv(env: BillingEnv): BillingCurrency {
  const configured = env.BILLING_CURRENCY?.trim() ?? "";
  if (configured === "") {
    return DEFAULT_BILLING_CURRENCY;
  }
  if (!isBillingCurrency(configured)) {
    throw new Error(
      `BILLING_CURRENCY must be one of: ${BILLING_CURRENCIES.join(", ")}.`
    );
  }
  return configured;
}
