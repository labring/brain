import "server-only";

import {
  type BillingCurrency,
  getBillingCurrencyFromEnv,
  getBillingGpuEnabledFromEnv,
} from "./config-core";

export function getBillingCurrency(): BillingCurrency {
  return getBillingCurrencyFromEnv(process.env);
}

export function getBillingGpuEnabled(): boolean {
  return getBillingGpuEnabledFromEnv(process.env);
}
