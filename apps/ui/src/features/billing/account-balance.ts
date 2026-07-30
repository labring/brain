import { z } from "zod";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";
import type { BillingCurrency } from "./config-core";

const MICRO_UNITS_PER_CURRENCY_UNIT = 1_000_000;
const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const CNY_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "CNY",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency",
});
const SHELL_COIN_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const CURRENCY_FORMATTERS = {
  cny: (amount: number) => CNY_FORMATTER.format(amount),
  shellCoin: (amount: number) =>
    `${SHELL_COIN_FORMATTER.format(amount)} ShellCoin`,
  usd: (amount: number) => USD_FORMATTER.format(amount),
} satisfies Record<BillingCurrency, (amount: number) => string>;

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
  return CURRENCY_FORMATTERS[balance.currency](
    balance.microUnits / MICRO_UNITS_PER_CURRENCY_UNIT
  );
}
