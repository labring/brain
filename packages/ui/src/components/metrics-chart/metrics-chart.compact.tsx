"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { useId, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import type { MetricDataPoint } from "./metrics-chart.types";

export interface MetricsChartCompactProps {
  chartClassName?: string;
  color?: string;
  data: MetricDataPoint[];
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

/** Single-series compact area chart for dense pane cards. */
export function MetricsChartCompact({
  chartClassName,
  color = "var(--color-blue-500)",
  data,
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
        },
      }}
    >
      <AreaChart
        data={chartData}
        margin={{ bottom: 0, left: 0, right: 0, top: 0 }}
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
        <XAxis dataKey="readableTime" hide />
        <YAxis domain={[0, 100]} hide ticks={[50, 100]} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
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
