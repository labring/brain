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
  /** Lifetime deductions — zero means the account has never been billed. */
  lifetimeDeductionMicroUnits: number;
  microUnits: number;
}

export interface AccountBalanceTerms {
  /** Balance − DeductionBalance: the cash term of the available amount, before credits. */
  cashMicroUnits: number;
  /** Lifetime deductions — zero means the account has never been billed. */
  lifetimeDeductionMicroUnits: number;
}

/**
 * The account read behind every debt judgment: the cash term of the
 * available Account Balance plus the lifetime-deduction fact the platform's
 * state machine gates on. Currency-free, for surfaces that judge the amount
 * rather than display it (the status hint's Account Debt evaluation).
 */
export async function loadAccountBalanceTerms(
  credentials: { appToken: string; kubeconfig: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountBalanceTerms> {
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
  return {
    cashMicroUnits:
      parsed.data.account.Balance - parsed.data.account.DeductionBalance,
    lifetimeDeductionMicroUnits: parsed.data.account.DeductionBalance,
  };
}

export async function loadAccountBalance(
  credentials: {
    appToken: string;
    currency: BillingCurrency;
    kubeconfig: string;
  },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountBalance> {
  const terms = await loadAccountBalanceTerms(
    { appToken: credentials.appToken, kubeconfig: credentials.kubeconfig },
    fetch
  );
  return {
    currency: credentials.currency,
    lifetimeDeductionMicroUnits: terms.lifetimeDeductionMicroUnits,
    microUnits: terms.cashMicroUnits,
  };
}
