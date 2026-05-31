"use client";

import NumberFlow from "@number-flow/react";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ComponentType, ReactNode, SVGProps } from "react";

import {
  CanvasNodeStatusDot,
  DEFAULT_CANVAS_NODE_STATUS,
  getCanvasNodeStatusTextClassName,
  resolveCanvasNodeStatus,
} from "./canvas-node.status";
import type { CanvasNodeStatus } from "./canvas-node.types";

export type CanvasNodeMetricValue = number | string | undefined;

export type CanvasNodeMetricValueFormat = "default" | "percent";

export type CanvasNodeMetricRecord<Key extends string = string> = Partial<
  Record<Key, CanvasNodeMetricValue>
>;

export interface CanvasNodeMetricListItem<Key extends string = string> {
  format?: CanvasNodeMetricValueFormat;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: Key;
  label: string;
}

export interface CanvasNodeMetricListProps<Key extends string = string>
  extends Omit<ComponentProps<"div">, "children"> {
  children?: ReactNode;
  items: readonly CanvasNodeMetricListItem<Key>[];
  valueFormat?: CanvasNodeMetricValueFormat;
  values?: CanvasNodeMetricRecord<Key>;
}

const CANVAS_NODE_METRIC_PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const CANVAS_NODE_METRIC_PERCENT_PATTERN = /^(-?\d+(?:\.\d+)?)\s*%$/;
const CANVAS_NODE_RESOURCE_PRESSURE_ELEVATED_THRESHOLD = 75;
const CANVAS_NODE_RESOURCE_PRESSURE_CRITICAL_THRESHOLD = 90;

function formatCanvasNodeMetricPercent(value: number) {
  return Number.isFinite(value)
    ? `${CANVAS_NODE_METRIC_PERCENT_FORMATTER.format(value)}%`
    : "--";
}

function parseCanvasNodeMetricPercentValue(
  value: CanvasNodeMetricValue
): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const percentMatch = CANVAS_NODE_METRIC_PERCENT_PATTERN.exec(trimmed);
  const n = percentMatch ? Number(percentMatch[1]) : Number(trimmed);

  return Number.isFinite(n) ? n : undefined;
}

function getCanvasNodeResourcePressureTextClassName(value: number) {
  if (value > CANVAS_NODE_RESOURCE_PRESSURE_CRITICAL_THRESHOLD) {
    return "text-red-500";
  }

  if (value >= CANVAS_NODE_RESOURCE_PRESSURE_ELEVATED_THRESHOLD) {
    return "text-amber-500";
  }

  return "text-muted-foreground";
}

function getCanvasNodeMetricTextClassName(
  format: CanvasNodeMetricValueFormat | undefined,
  percentValue: number | undefined
) {
  if (format !== "percent") {
    return "text-muted-foreground";
  }

  if (percentValue === undefined) {
    return "text-muted-foreground";
  }

  return getCanvasNodeResourcePressureTextClassName(percentValue);
}

export function formatCanvasNodeMetricValue(
  value: CanvasNodeMetricValue,
  format: CanvasNodeMetricValueFormat = "default"
) {
  if (format === "percent") {
    const percentValue = parseCanvasNodeMetricPercentValue(value);
    if (percentValue !== undefined) {
      return formatCanvasNodeMetricPercent(percentValue);
    }

    return typeof value === "string" ? value.trim() || "--" : "--";
  }

  if (typeof value === "number") {
    return String(value);
  }

  const trimmed = value?.trim();

  return trimmed || "--";
}

export function CanvasNodeFooterStatus({
  className,
  status = DEFAULT_CANVAS_NODE_STATUS,
}: {
  className?: string;
  status?: CanvasNodeStatus;
}) {
  const resolvedStatus = resolveCanvasNodeStatus(status);

  return (
    <span
      className={cn(
        "flex h-5 min-w-0 shrink-0 items-center gap-1.5 rounded-full",
        className
      )}
    >
      <CanvasNodeStatusDot size="small" status={resolvedStatus} />
      <span
        className={cn("truncate", getCanvasNodeStatusTextClassName(status))}
      >
        {resolvedStatus.label}
      </span>
    </span>
  );
}

export function CanvasNodeMetrics({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-end gap-2 text-xs leading-none",
        className
      )}
      data-slot="canvas-node-metrics"
      {...props}
    />
  );
}

export function CanvasNodeMetric({
  children,
  className,
  format,
  label,
  value,
}: {
  children?: ReactNode;
  className?: string;
  format?: CanvasNodeMetricValueFormat;
  label: string;
  value: CanvasNodeMetricValue;
}) {
  const formattedValue = formatCanvasNodeMetricValue(value, format);
  const percentValue =
    format === "percent" ? parseCanvasNodeMetricPercentValue(value) : undefined;
  const metricTextClassName = getCanvasNodeMetricTextClassName(
    format,
    percentValue
  );

  return (
    <span
      className={cn(
        "flex h-5 min-w-0 shrink-0 items-center rounded-full transition-colors duration-200",
        metricTextClassName,
        className
      )}
    >
      <span className="sr-only">{`${label}: ${formattedValue}`}</span>
      <span aria-hidden className="flex min-w-0 shrink-0 items-center gap-1.5">
        {children}
        {percentValue === undefined ? (
          <span className="truncate tabular-nums">{formattedValue}</span>
        ) : (
          <NumberFlow
            className="truncate tabular-nums"
            format={{
              maximumFractionDigits: 0,
              style: "percent",
            }}
            isolate
            locales="en-US"
            value={percentValue / 100}
            willChange
          />
        )}
      </span>
    </span>
  );
}

export function CanvasNodeMetricList<Key extends string = string>({
  children,
  className,
  items,
  valueFormat = "percent",
  values,
  ...props
}: CanvasNodeMetricListProps<Key>) {
  return (
    <CanvasNodeMetrics className={className} {...props}>
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <CanvasNodeMetric
            format={item.format ?? valueFormat}
            key={item.key}
            label={item.label}
            value={values?.[item.key]}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
          </CanvasNodeMetric>
        );
      })}
      {children}
    </CanvasNodeMetrics>
  );
}
