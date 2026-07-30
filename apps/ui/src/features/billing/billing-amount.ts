import type { BillingCurrency } from "@/features/billing/config-core";

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
const COMPACT_USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency",
});
const COMPACT_CNY_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "CNY",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency",
});
const COMPACT_SHELL_COIN_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const PRECISE_USD_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 6,
  minimumFractionDigits: 6,
  style: "currency",
});
const PRECISE_CNY_FORMATTER = new Intl.NumberFormat("en-US", {
  currency: "CNY",
  currencyDisplay: "narrowSymbol",
  maximumFractionDigits: 6,
  minimumFractionDigits: 6,
  style: "currency",
});
const PRECISE_SHELL_COIN_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
  minimumFractionDigits: 6,
});
const CURRENCY_FORMATTERS = {
  cny: (amount: number) => CNY_FORMATTER.format(amount),
  shellCoin: (amount: number) =>
    `${SHELL_COIN_FORMATTER.format(amount)} ShellCoin`,
  usd: (amount: number) => USD_FORMATTER.format(amount),
} satisfies Record<BillingCurrency, (amount: number) => string>;
const COMPACT_CURRENCY_FORMATTERS = {
  cny: (amount: number) => COMPACT_CNY_FORMATTER.format(amount),
  shellCoin: (amount: number) =>
    `${COMPACT_SHELL_COIN_FORMATTER.format(amount)} ShellCoin`,
  usd: (amount: number) => COMPACT_USD_FORMATTER.format(amount),
} satisfies Record<BillingCurrency, (amount: number) => string>;
const PRECISE_CURRENCY_FORMATTERS = {
  cny: (amount: number) => PRECISE_CNY_FORMATTER.format(amount),
  shellCoin: (amount: number) =>
    `${PRECISE_SHELL_COIN_FORMATTER.format(amount)} ShellCoin`,
  usd: (amount: number) => PRECISE_USD_FORMATTER.format(amount),
} satisfies Record<BillingCurrency, (amount: number) => string>;

export function formatBillingAmount(
  microUnits: number,
  currency: BillingCurrency
): string {
  return CURRENCY_FORMATTERS[currency](
    microUnits / MICRO_UNITS_PER_CURRENCY_UNIT
  );
}

export function formatCompactBillingAmount(
  microUnits: number,
  currency: BillingCurrency
): string {
  return COMPACT_CURRENCY_FORMATTERS[currency](
    microUnits / MICRO_UNITS_PER_CURRENCY_UNIT
  );
}

export function formatPreciseBillingAmount(
  microUnits: number,
  currency: BillingCurrency
): string {
  return PRECISE_CURRENCY_FORMATTERS[currency](
    microUnits / MICRO_UNITS_PER_CURRENCY_UNIT
  );
}
