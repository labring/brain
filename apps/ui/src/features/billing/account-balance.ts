import { z } from "zod";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";
import type { BillingCurrency } from "./config-core";

const accountBalanceResponseSchema = z.object({
  account: z.object({
    Balance: z.number(),
    DeductionBalance: z.number(),
  }),
});

type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export interface AccountBalance {
  currency: BillingCurrency;
  microUnits: number;
}

function responseErrorMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  return "Could not load Account Balance.";
}

export async function loadAccountBalance(
  credentials: {
    appToken: string;
    currency: BillingCurrency;
    kubeconfig: string;
  },
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountBalance> {
  const response = await fetch("/api/billing/account", {
    cache: "no-store",
    headers: personalResourceAuthHeaders(credentials),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(payload));
  }

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
