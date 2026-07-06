"use client";

import { MetricsChart } from "@workspace/ui/components/metrics-chart/metrics-chart";
import type { MetricDataPoint } from "@workspace/ui/components/metrics-chart/metrics-chart.types";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentType, ReactNode, SVGProps } from "react";

import { formatMetricTrend } from "./database-metrics-format";

/**
 * Shared card frame for compact metric series (trailing 60m live window).
 * The chart reads left → right, oldest → newest; the embedded time axis
 * labels round clock times and pins "Now" at the right edge.
 */
export function MetricSeriesCard({
  bottomRight,
  className,
  icon: Icon,
  label,
  series,
  topRight,
}: {
  bottomRight?: ReactNode;
  className?: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  series: MetricDataPoint[];
  topRight?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex h-54 min-h-54 min-w-0 flex-col gap-6 overflow-hidden rounded-lg bg-white/5 p-4 shadow-sm",
        className
      )}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5">
            <Icon aria-hidden className="size-4 shrink-0 text-foreground" />
            <h3 className="truncate font-medium text-foreground text-sm leading-5">
              {label}
            </h3>
          </div>
          {topRight}
        </div>
        <div className="flex min-w-0 justify-between gap-3 text-sm leading-5">
          <p className="truncate text-muted-foreground">
            {formatMetricTrend(series)}
          </p>
          {bottomRight}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {series.length === 0 ? (
          <div className="flex h-full min-h-0 flex-col pb-6">
            <div className="flex min-h-0 flex-1 items-center justify-center border-border border-y text-muted-foreground text-xs">
              No telemetry
            </div>
          </div>
        ) : (
          <MetricsChart.Compact
            chartClassName="h-full min-h-0 w-full min-w-0 aspect-auto"
            data={series}
            label={label}
          />
        )}
      </div>
    </section>
  );
}
