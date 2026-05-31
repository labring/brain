"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { METRICS_CHART_SURFACE_CLASS_DEFAULT } from "./metrics-chart.defaults";
import type { MetricsData } from "./metrics-chart.types";
import { useMetricsChart } from "./metrics-chart.use";

const CHART_PALETTE = [
  "var(--color-blue-500)",
  "var(--color-emerald-500)",
  "var(--color-amber-500)",
  "var(--color-fuchsia-500)",
  "var(--color-rose-500)",
] as const;

const METRIC_KEYS_FOR_COLOR = [
  "cpu",
  "memory",
  "disk",
  "storage",
  "uptime",
] as const;

function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function capitalizeLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function getColorForMetricKey(key: string): string {
  const lower = key.toLowerCase();
  const idx = (METRIC_KEYS_FOR_COLOR as readonly string[]).indexOf(lower);
  const paletteIndex = idx >= 0 ? idx % CHART_PALETTE.length : 0;
  return CHART_PALETTE[paletteIndex] ?? CHART_PALETTE[0];
}

function mergeMetricsByTimestamp(
  data: MetricsData
): Record<string, number | string>[] {
  const allTimestamps = new Set<number>();
  for (const series of Object.values(data)) {
    for (const point of series) {
      allTimestamps.add(point.timestamp);
    }
  }
  const sorted = Array.from(allTimestamps).sort((a, b) => a - b);
  return sorted.map((timestamp) => {
    const point: Record<string, number | string> = {
      timestamp,
      readableTime: formatTimestamp(timestamp),
    };
    for (const [key, series] of Object.entries(data)) {
      const found = series.find((d) => d.timestamp === timestamp);
      if (found != null) {
        point[key] = found.value;
      }
    }
    return point;
  });
}

export function MetricsChartArea() {
  const { data, dataKey, chartClassName } = useMetricsChart();

  const keys = useMemo(
    () => (dataKey == null ? Object.keys(data) : [dataKey]),
    [data, dataKey]
  );

  const chartData = useMemo(() => {
    if (dataKey != null) {
      const series = data[dataKey];
      if (!series) {
        return [];
      }
      return series.map(({ timestamp, value }) => ({
        timestamp,
        value,
        readableTime: formatTimestamp(timestamp),
      }));
    }
    return mergeMetricsByTimestamp(data);
  }, [data, dataKey]);

  const config = useMemo<ChartConfig>(() => {
    const cfg: ChartConfig = {};
    const configKeys = dataKey == null ? keys : ["value"];
    for (const key of configKeys) {
      const labelKey = dataKey ?? key;
      cfg[key] = {
        color: getColorForMetricKey(labelKey),
        label: capitalizeLabel(labelKey),
      };
    }
    return cfg;
  }, [keys, dataKey]);

  const hasData = chartData.length > 0 && keys.length > 0;
  if (!hasData) {
    return null;
  }

  const areas = dataKey == null ? keys : ["value"];

  const gradientIdFor = (seriesKey: string) => `fill-${dataKey ?? seriesKey}`;

  return (
    <ChartContainer
      className={chartClassName || METRICS_CHART_SURFACE_CLASS_DEFAULT}
      config={config}
    >
      <AreaChart
        data={chartData}
        margin={{ top: 8, right: 8, bottom: 4, left: -30 }}
      >
        <defs>
          {areas.map((seriesKey) => {
            const id = gradientIdFor(seriesKey);
            return (
              <linearGradient id={id} key={id} x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="5%"
                  stopColor={`var(--color-${seriesKey})`}
                  stopOpacity={0.8}
                />
                <stop
                  offset="95%"
                  stopColor={`var(--color-${seriesKey})`}
                  stopOpacity={0.1}
                />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="readableTime"
          tickFormatter={(v) =>
            typeof v === "string" ? (v.split(" ").at(-1) ?? v) : String(v)
          }
          tickLine={false}
          tickMargin={4}
        />
        <YAxis
          axisLine={false}
          domain={[0, 100]}
          tickLine={false}
          tickMargin={4}
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
        <ChartLegend content={<ChartLegendContent />} verticalAlign="bottom" />
        {areas.map((seriesKey) => (
          <Area
            dataKey={seriesKey}
            fill={`url(#${gradientIdFor(seriesKey)})`}
            isAnimationActive={false}
            key={seriesKey}
            stroke={`var(--color-${seriesKey})`}
            type="monotone"
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
