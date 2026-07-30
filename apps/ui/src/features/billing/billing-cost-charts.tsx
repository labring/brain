"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  formatBillingAmount,
  formatCompactBillingAmount,
} from "@/features/billing/billing-amount";
import type {
  DailyExpenditurePoint,
  MonthlyBillingTrendPoint,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

const DAILY_CHART_CONFIG = {
  expenditureMicroUnits: {
    color: "var(--color-brand-primary)",
    label: "Expenditure",
  },
} satisfies ChartConfig;

const MONTHLY_CHART_CONFIG = {
  expenditureMicroUnits: {
    color: "var(--color-brand-primary)",
    label: "Expenditure",
  },
  paymentMicroUnits: {
    color: "var(--color-foreground)",
    label: "Payments",
  },
} satisfies ChartConfig;

interface BillingCostChartsProps {
  currency: BillingCurrency;
  daily: DailyExpenditurePoint[];
  monthly: MonthlyBillingTrendPoint[];
}

export function BillingCostCharts({
  currency,
  daily,
  monthly,
}: BillingCostChartsProps) {
  const formatAmount = (value: number) => formatBillingAmount(value, currency);
  const formatAxisAmount = (value: number) =>
    formatCompactBillingAmount(value, currency);

  return (
    <div className="grid gap-8 xl:grid-cols-2" data-slot="billing-cost-charts">
      <section className="min-w-0 border-border border-b pb-6 xl:border-r xl:border-b-0 xl:pr-8">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-foreground text-sm">Cost trend</h2>
          <span className="text-muted-foreground text-xs">Selected period</span>
        </div>
        <ChartContainer
          className="aspect-auto h-72 w-full"
          config={DAILY_CHART_CONFIG}
        >
          <LineChart accessibilityLayer data={daily}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              minTickGap={24}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={formatAxisAmount}
              tickLine={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent valueFormatter={formatAmount} />}
              cursor={false}
            />
            <Line
              dataKey="expenditureMicroUnits"
              dot={false}
              stroke="var(--color-expenditureMicroUnits)"
              type="monotone"
            />
          </LineChart>
        </ChartContainer>
      </section>

      <section className="min-w-0">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="font-medium text-foreground text-sm">
            Expenditure vs payments
          </h2>
          <span className="text-muted-foreground text-xs">By month</span>
        </div>
        <ChartContainer
          className="aspect-auto h-72 w-full"
          config={MONTHLY_CHART_CONFIG}
        >
          <BarChart accessibilityLayer data={monthly}>
            <CartesianGrid vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="label"
              minTickGap={24}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tickFormatter={formatAxisAmount}
              tickLine={false}
            />
            <ChartTooltip
              content={<ChartTooltipContent valueFormatter={formatAmount} />}
              cursor={false}
            />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="expenditureMicroUnits"
              fill="var(--color-expenditureMicroUnits)"
            />
            <Bar
              dataKey="paymentMicroUnits"
              fill="var(--color-paymentMicroUnits)"
            />
          </BarChart>
        </ChartContainer>
      </section>
    </div>
  );
}
