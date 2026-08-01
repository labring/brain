"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { Separator } from "@workspace/ui/components/separator";
import { Fragment, type ReactNode } from "react";
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
  DailyCostTrend,
  MonthlyBillingTrendPoint,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

// Cost Center's trend palette (blue/teal/violet/amber/cyan), mapped to the
// nearest Tailwind scale tokens; Total always takes the brand primary.
const TREND_SERIES_COLORS = [
  "var(--color-brand-primary)",
  "var(--color-teal-400)",
  "var(--color-violet-400)",
  "var(--color-amber-500)",
  "var(--color-cyan-400)",
];

// Cost Center's bar pairing: expenditure near-neutral, payments in blue.
const MONTHLY_CHART_CONFIG = {
  expenditureMicroUnits: {
    color: "var(--color-foreground)",
    label: "Expenditure",
  },
  paymentMicroUnits: {
    color: "var(--color-brand-primary)",
    label: "Payments",
  },
} satisfies ChartConfig;

interface BillingCostChartsProps {
  currency: BillingCurrency;
  daily: DailyCostTrend;
  monthly: MonthlyBillingTrendPoint[];
}

function ChartCard({
  children,
  subtitles,
  title,
}: {
  children: ReactNode;
  subtitles: string[];
  title: string;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border">
      <div className="flex h-16 items-center gap-3 border-border border-b px-6">
        <h3 className="font-medium text-foreground text-sm">{title}</h3>
        {subtitles.map((subtitle) => (
          <Fragment key={subtitle}>
            <Separator className="h-4" orientation="vertical" />
            <span className="text-muted-foreground text-xs">{subtitle}</span>
          </Fragment>
        ))}
      </div>
      <div className="px-8 py-4">{children}</div>
    </section>
  );
}

export function BillingCostCharts({
  currency,
  daily,
  monthly,
}: BillingCostChartsProps) {
  const formatAmount = (value: number) => formatBillingAmount(value, currency);
  const formatAxisAmount = (value: number) =>
    formatCompactBillingAmount(value, currency);
  const dailyChartConfig: ChartConfig = Object.fromEntries(
    daily.series.map((series, index) => [
      series.dataKey,
      {
        color: TREND_SERIES_COLORS[index % TREND_SERIES_COLORS.length],
        label: series.label,
      },
    ])
  );

  return (
    <div className="flex flex-col gap-4" data-slot="billing-cost-charts">
      <ChartCard subtitles={["Selected period"]} title="Cost trend">
        <ChartContainer
          className="aspect-auto h-72 w-full"
          config={dailyChartConfig}
        >
          <LineChart accessibilityLayer data={daily.points}>
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
            />
            {/* itemSorter defaults to alphabetical; null keeps series order,
                so the merged Total legend entry stays first. */}
            <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
            {daily.series.map((series) => (
              <Line
                dataKey={series.dataKey}
                dot={{ r: 2.5 }}
                key={series.dataKey}
                stroke={`var(--color-${series.dataKey})`}
                strokeWidth={2}
                type="monotone"
              />
            ))}
          </LineChart>
        </ChartContainer>
      </ChartCard>

      <ChartCard subtitles={["By month"]} title="Expenditure vs payments">
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
      </ChartCard>
    </div>
  );
}
