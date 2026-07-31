import { z } from "zod";

import { formatBillingAmount } from "@/features/billing/billing-amount";
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

export async function loadAccountBalance(
  credentials: {
    appToken: string;
    currency: BillingCurrency;
    kubeconfig: string;
  },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountBalance> {
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
    currency: credentials.currency,
    microUnits:
      parsed.data.account.Balance - parsed.data.account.DeductionBalance,
  };
}

export function formatAccountBalance(balance: AccountBalance): string {
  return formatBillingAmount(balance.microUnits, balance.currency);
}
