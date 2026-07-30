import "server-only";

import { type BillingCurrency, getBillingCurrencyFromEnv } from "./config-core";

export function getBillingCurrency(): BillingCurrency {
  return getBillingCurrencyFromEnv(process.env);
}
