"use client";

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useLogViewerContext } from "./log-viewer.context";
import { formatLogTime } from "./log-viewer.utils";
import { logWindowBounds } from "./log-window";

const chartConfig = {
  count: {
    label: "Count",
    color: "color-mix(in oklab, var(--color-blue-500) 70%, transparent)",
  },
} satisfies ChartConfig;

export function LogViewerCountChart() {
  const { filteredEntries, logWindow } = useLogViewerContext();

  const buckets = useMemo(() => {
    const bounds = logWindowBounds(logWindow);
    const rangeStart = bounds.start.getTime();
    const rangeEnd = bounds.end.getTime();

    const span = rangeEnd - rangeStart;
    if (span <= 0) {
      return [
        { time: formatLogTime(new Date(rangeStart).toISOString()), count: 0 },
      ];
    }

    const bucketCount = 30;
    const interval = span / bucketCount;

    const counts = new Array<number>(bucketCount).fill(0);
    for (const e of filteredEntries) {
      const t = new Date(e.time).getTime();
      if (t < rangeStart || t > rangeEnd) {
        continue;
      }
      const idx = Math.min(
        Math.floor((t - rangeStart) / interval),
        bucketCount - 1
      );
      counts[idx] = (counts[idx] ?? 0) + 1;
    }

    return counts.map((count, i) => ({
      time: formatLogTime(new Date(rangeStart + i * interval).toISOString()),
      count,
    }));
  }, [filteredEntries, logWindow]);

  return (
    <ChartContainer
      className="aspect-auto h-[90px] w-full p-2"
      config={chartConfig}
      data-slot="log-viewer-count-chart"
    >
      <BarChart
        barCategoryGap="10%"
        data={buckets}
        margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          axisLine={false}
          dataKey="time"
          fontSize={10}
          height={20}
          interval="preserveStartEnd"
          tickFormatter={(v: string) => {
            const parts = v.split(" ");
            return parts[1]?.slice(0, 5) ?? v;
          }}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          axisLine={false}
          fontSize={10}
          tickLine={false}
          width={24}
        />
        <ChartTooltip
          content={<ChartTooltipContent />}
          cursor={{ fill: "var(--color-count)", opacity: 0.1 }}
        />
        <Bar dataKey="count" fill="var(--color-count)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
