import { z } from "zod";

import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import type { BillingCurrency } from "./config-core";

const accountBalanceResponseSchema = z.object({
  account: z.object({
    Balance: z.number(),
    DeductionBalance: z.number(),
  }),
});

export interface AccountBalance {
  currency: BillingCurrency;
  microUnits: number;
}

/**
 * The cash term of the available Account Balance: Balance − DeductionBalance,
 * before credits. Currency-free, for surfaces that judge the amount rather
 * than display it (the status hint's Account Debt evaluation).
 */
export async function loadAccountBalanceMicroUnits(
  credentials: { appToken: string; kubeconfig: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<number> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load Account Balance.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/account");
  const parsed = accountBalanceResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Account Balance response is invalid.");
  }
  return parsed.data.account.Balance - parsed.data.account.DeductionBalance;
}

export async function loadAccountBalance(
  credentials: {
    appToken: string;
    currency: BillingCurrency;
    kubeconfig: string;
  },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountBalance> {
  return {
    currency: credentials.currency,
    microUnits: await loadAccountBalanceMicroUnits(
      { appToken: credentials.appToken, kubeconfig: credentials.kubeconfig },
      fetch
    ),
  };
}
