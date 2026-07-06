"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  type XAxisTickContentProps,
  YAxis,
} from "recharts";

import type { MetricDataPoint } from "./metrics-chart.types";

export interface MetricsChartCompactProps {
  chartClassName?: string;
  color?: string;
  data: MetricDataPoint[];
  /** Series name shown in the tooltip. @default "Value" */
  label?: string;
}

const COMPACT_CHART_CONFIG = {
  value: {
    color: "var(--color-blue-500)",
    label: "Value",
  },
} satisfies ChartConfig;

function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const TIME_TICK_ROUND_MINUTES = 15;
/** Samples this close to the window edges never get a round-time tick, so
 * labels neither clip at the left edge nor collide with the "Now" tick. */
const TIME_TICK_START_CLEARANCE = 4;
const TIME_TICK_END_CLEARANCE = 8;

function timeAxisTick(nowValue: string) {
  return ({ payload, x, y }: XAxisTickContentProps) => {
    const value = String(payload.value ?? "");
    const isNow = value === nowValue;
    return (
      <text
        className="fill-muted-foreground"
        dy="0.71em"
        textAnchor={isNow ? "end" : "middle"}
        x={x}
        y={y}
      >
        {isNow ? "Now" : value}
      </text>
    );
  };
}

/** Single-series compact area chart for dense pane cards. */
export function MetricsChartCompact({
  chartClassName,
  color = "var(--color-blue-500)",
  data,
  label = COMPACT_CHART_CONFIG.value.label,
}: MetricsChartCompactProps) {
  const gradientId = useId().replace(/:/g, "");
  const chartData = useMemo(
    () =>
      data.map(({ timestamp, value }) => ({
        readableTime: formatTimestamp(timestamp),
        timestamp,
        value,
      })),
    [data]
  );

  const nowTick = chartData.at(-1)?.readableTime ?? "";
  const timeTicks = useMemo(() => {
    const last = chartData.length - 1;
    const ticks: string[] = [];
    for (const [i, point] of chartData.entries()) {
      const isRound =
        new Date(point.timestamp * 1000).getMinutes() %
          TIME_TICK_ROUND_MINUTES ===
        0;
      if (
        isRound &&
        i >= TIME_TICK_START_CLEARANCE &&
        last - i >= TIME_TICK_END_CLEARANCE
      ) {
        ticks.push(point.readableTime);
      }
    }
    const now = chartData.at(-1);
    if (now) {
      ticks.push(now.readableTime);
    }
    return ticks;
  }, [chartData]);

  if (chartData.length === 0) {
    return null;
  }

  return (
    <ChartContainer
      className={chartClassName}
      config={{
        value: {
          ...COMPACT_CHART_CONFIG.value,
          color,
          label,
        },
      }}
    >
      <AreaChart
        data={chartData}
        margin={{ bottom: 0, left: 0, right: 0, top: 8 }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop
              offset="5%"
              stopColor="var(--color-value)"
              stopOpacity={0.62}
            />
            <stop
              offset="95%"
              stopColor="var(--color-value)"
              stopOpacity={0.4}
            />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="readableTime"
          height={24}
          interval={0}
          tick={timeAxisTick(nowTick)}
          tickLine={false}
          tickMargin={4}
          ticks={timeTicks}
        />
        <YAxis
          axisLine={false}
          domain={[0, 100]}
          mirror
          orientation="right"
          tick={{ fill: "var(--muted-foreground)" }}
          tickFormatter={(v) => `${v}%`}
          tickLine={false}
          ticks={[50, 100]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              valueFormatter={(v) => `${Number(v).toFixed(1)}%`}
            />
          }
          trigger="hover"
        />
        <Area
          activeDot={{ fill: "var(--color-value)", r: 4, strokeWidth: 0 }}
          dataKey="value"
          dot={false}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
          stroke="var(--color-value)"
          strokeWidth={1.5}
          type="natural"
        />
      </AreaChart>
    </ChartContainer>
  );
}
