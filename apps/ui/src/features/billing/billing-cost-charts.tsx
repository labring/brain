"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
} from "@workspace/ui/components/chart";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Fragment, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  type DefaultLegendContentProps,
  Line,
  LineChart,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";

import {
  billingCurrencySymbol,
  formatBillingAmount,
  formatCompactBillingAmount,
} from "@/features/billing/billing-amount";
import type {
  DailyCostTrend,
  MonthlyBillingTrendPoint,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

// Series take the chart tokens in order; Total always comes first.
const TREND_SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

// Charges carry the saturated bar, top-ups the pale companion.
const MONTHLY_SERIES = [
  {
    color: "var(--color-blue-500)",
    dataKey: "expenditureMicroUnits",
    label: "Charges",
  },
  {
    color: "var(--color-blue-100)",
    dataKey: "paymentMicroUnits",
    label: "Top-ups",
  },
] as const;

const MONTHLY_CHART_CONFIG = Object.fromEntries(
  MONTHLY_SERIES.map((series) => [
    series.dataKey,
    { color: series.color, label: series.label },
  ])
) satisfies ChartConfig;

const MONTHLY_SERIES_LABELS = Object.fromEntries(
  MONTHLY_SERIES.map((series) => [series.dataKey, series.label])
);

const DASHED_GRID = "2 2";
const AXIS_LINE = { stroke: "var(--color-border)", strokeWidth: 1.5 };
const AXIS_TICK_LINE = { stroke: "var(--color-border)" };
// Headroom for the currency label sitting above the Y axis.
const CHART_MARGIN = { top: 24 };

const EMPTY_DAILY_TREND: DailyCostTrend = { points: [], series: [] };

// The two charts are fed by independent requests with disjoint failure
// modes, so each carries its own error/loading pair — one chart failing or
// lagging must never blank the other.
interface BillingCostChartsProps {
  currency: BillingCurrency;
  daily?: DailyCostTrend;
  dailyError?: unknown;
  isDailyLoading?: boolean;
  isMonthlyLoading?: boolean;
  monthly?: MonthlyBillingTrendPoint[];
  monthlyError?: unknown;
}

function currencyAxisLabel(symbol: string) {
  return {
    fill: "var(--color-muted-foreground)",
    offset: 12,
    position: "top",
    value: symbol,
  } as const;
}

function TrendTooltipContent({
  active,
  label,
  labels,
  payload,
  symbol,
  valueFormatter,
}: Partial<TooltipContentProps> & {
  labels: Record<string, string>;
  symbol: string;
  valueFormatter: (value: number) => string;
}) {
  if (!(active && payload?.length)) {
    return null;
  }
  return (
    <div className="w-50 rounded-lg border border-border bg-popover/80 p-4 backdrop-blur-xl">
      <p className="text-popover-foreground text-sm">{`${String(label)} (${symbol})`}</p>
      <div className="my-2 h-px w-full bg-border" />
      <div className="flex flex-col gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item) => {
            const seriesKey = String(item.dataKey ?? item.name);
            return (
              <div
                className="flex items-center justify-between gap-2 text-sm"
                key={seriesKey}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="truncate text-muted-foreground">
                    {labels[seriesKey] ?? seriesKey}
                  </span>
                </span>
                <span className="text-foreground tabular-nums">
                  {valueFormatter(Number(item.value))}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

/** Line-chart legend marker: a series-colored line through a hollow ring. */
function LineLegendContent({
  labels,
  payload,
}: {
  labels: Record<string, string>;
  payload?: DefaultLegendContentProps["payload"];
}) {
  if (!payload?.length) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-3 pt-3">
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => (
          <span
            className="flex items-center gap-1.5 text-muted-foreground text-xs"
            key={String(item.value)}
          >
            <svg
              aria-hidden="true"
              className="shrink-0"
              fill="none"
              height="10"
              viewBox="0 0 16 10"
              width="16"
            >
              <path d="M0 5H16" stroke={item.color} strokeWidth="2" />
              <circle
                cx="8"
                cy="5"
                fill="var(--main-action-surface-bg)"
                r="3"
                stroke={item.color}
                strokeWidth="2"
              />
            </svg>
            {labels[String(item.value)] ?? String(item.value)}
          </span>
        ))}
    </div>
  );
}

function BarLegendContent({
  labels,
  payload,
}: {
  labels: Record<string, string>;
  payload?: DefaultLegendContentProps["payload"];
}) {
  if (!payload?.length) {
    return null;
  }
  return (
    <div className="flex items-center justify-center gap-6 pt-3">
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => (
          <span
            className="flex items-center gap-1.5 text-muted-foreground text-xs"
            key={String(item.value)}
          >
            <span
              aria-hidden
              className="h-2 w-4 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color }}
            />
            {labels[String(item.value)] ?? String(item.value)}
          </span>
        ))}
    </div>
  );
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
    <section className="min-w-0 rounded-lg border border-border">
      <div className="flex h-18 items-center gap-3 border-border border-b p-4">
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

function ChartBody({
  children,
  error,
  isLoading,
}: {
  children: ReactNode;
  error: unknown;
  isLoading: boolean;
}) {
  if (isLoading) {
    return <Skeleton className="h-72 w-full bg-muted dark:bg-white/8" />;
  }
  if (error != null) {
    return (
      <div className="flex h-72 items-center justify-center text-muted-foreground text-sm">
        Trend data is unavailable.
      </div>
    );
  }
  return children;
}

export function BillingCostCharts({
  currency,
  daily = EMPTY_DAILY_TREND,
  dailyError = null,
  isDailyLoading = false,
  isMonthlyLoading = false,
  monthly = [],
  monthlyError = null,
}: BillingCostChartsProps) {
  const symbol = billingCurrencySymbol(currency);
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
  const dailySeriesLabels = Object.fromEntries(
    daily.series.map((series) => [series.dataKey, series.label])
  );

  return (
    <div className="flex flex-col gap-4" data-slot="billing-cost-charts">
      <ChartCard subtitles={["Last 7 days"]} title="Cost Trends">
        <ChartBody error={dailyError} isLoading={isDailyLoading}>
          <ChartContainer
            className="aspect-auto h-72 w-full"
            config={dailyChartConfig}
          >
            <LineChart
              accessibilityLayer
              data={daily.points}
              margin={CHART_MARGIN}
            >
              <CartesianGrid
                stroke="var(--color-border)"
                strokeDasharray={DASHED_GRID}
                vertical={false}
              />
              <XAxis
                axisLine={AXIS_LINE}
                dataKey="label"
                minTickGap={24}
                tickLine={AXIS_TICK_LINE}
                tickMargin={8}
                tickSize={4}
              />
              <YAxis
                axisLine={false}
                label={currencyAxisLabel(symbol)}
                tickFormatter={formatAxisAmount}
                tickLine={false}
              />
              <ChartTooltip
                content={
                  <TrendTooltipContent
                    labels={dailySeriesLabels}
                    symbol={symbol}
                    valueFormatter={formatAmount}
                  />
                }
                cursor={{
                  stroke: "var(--color-muted-foreground)",
                  strokeDasharray: DASHED_GRID,
                }}
              />
              {/* itemSorter defaults to alphabetical; null keeps series order,
                  so the merged Total legend entry stays first. */}
              <ChartLegend
                content={<LineLegendContent labels={dailySeriesLabels} />}
                itemSorter={null}
              />
              {daily.series.map((series) => (
                <Line
                  activeDot={{
                    fill: "var(--main-action-surface-bg)",
                    r: 3,
                    stroke: `var(--color-${series.dataKey})`,
                    strokeWidth: 2,
                  }}
                  dataKey={series.dataKey}
                  dot={false}
                  key={series.dataKey}
                  stroke={`var(--color-${series.dataKey})`}
                  strokeWidth={1.5}
                  type="monotone"
                />
              ))}
            </LineChart>
          </ChartContainer>
        </ChartBody>
      </ChartCard>

      <ChartCard
        subtitles={["Last 6 Months", "Current Region"]}
        title="Monthly Top-ups and Charges"
      >
        <ChartBody error={monthlyError} isLoading={isMonthlyLoading}>
          <ChartContainer
            className="aspect-auto h-72 w-full"
            config={MONTHLY_CHART_CONFIG}
          >
            <BarChart
              accessibilityLayer
              barGap={0}
              data={monthly}
              margin={CHART_MARGIN}
            >
              <CartesianGrid
                stroke="var(--color-border)"
                strokeDasharray={DASHED_GRID}
                vertical={false}
              />
              <XAxis
                axisLine={AXIS_LINE}
                dataKey="label"
                minTickGap={24}
                tickLine={AXIS_TICK_LINE}
                tickMargin={8}
                tickSize={4}
              />
              <YAxis
                axisLine={false}
                label={currencyAxisLabel(symbol)}
                tickFormatter={formatAxisAmount}
                tickLine={false}
              />
              <ChartTooltip
                content={
                  <TrendTooltipContent
                    labels={MONTHLY_SERIES_LABELS}
                    symbol={symbol}
                    valueFormatter={formatAmount}
                  />
                }
              />
              <ChartLegend
                content={<BarLegendContent labels={MONTHLY_SERIES_LABELS} />}
              />
              {MONTHLY_SERIES.map((series) => (
                <Bar
                  dataKey={series.dataKey}
                  fill={`var(--color-${series.dataKey})`}
                  key={series.dataKey}
                  maxBarSize={60}
                />
              ))}
            </BarChart>
          </ChartContainer>
        </ChartBody>
      </ChartCard>
    </div>
  );
}
