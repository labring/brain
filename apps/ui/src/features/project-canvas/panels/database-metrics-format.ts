import type {
  DatabaseNodeMetricKey,
  DatabaseNodeMetricValue,
} from "@workspace/ui/components/database-node/database-node";
import type { MetricDataPoint } from "@workspace/ui/components/metrics-chart/metrics-chart.types";

import { computeMetricTrend } from "@/features/project-canvas/telemetry/compute-metric-trend";

const PERCENT_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const ZERO_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const ONE_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const TWO_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const THREE_DECIMAL_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
  minimumFractionDigits: 0,
});

const PERCENT_SUFFIX_PATTERN = /%$/;
const STORAGE_QUANTITY_PATTERN = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti)?$/i;

function metricNumber(value: DatabaseNodeMetricValue | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed.replace(PERCENT_SUFFIX_PATTERN, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampPercent(value: number | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return Math.min(100, Math.max(0, value));
}

export function latestPercent(
  series: readonly MetricDataPoint[],
  fallback: DatabaseNodeMetricValue | undefined
) {
  return clampPercent(series.at(-1)?.value ?? metricNumber(fallback));
}

export function formatPercent(value: number | undefined) {
  return value === undefined ? "--" : `${PERCENT_FORMATTER.format(value)}%`;
}

export function formatMetricTrend(series: readonly MetricDataPoint[]) {
  const trend = computeMetricTrend(series);
  return trend.charAt(0).toUpperCase() + trend.slice(1);
}

function parseCpuCores(capacity: string | undefined) {
  if (capacity === undefined) {
    return undefined;
  }
  const trimmed = capacity.trim();
  if (trimmed.endsWith("m")) {
    const millicores = Number(trimmed.slice(0, -1));
    return Number.isFinite(millicores) ? millicores / 1000 : undefined;
  }
  const cores = Number(trimmed);
  return Number.isFinite(cores) ? cores : undefined;
}

function formatCpuCores(cores: number) {
  if (cores > 0 && cores < 0.001) {
    return "<0.001";
  }
  const absoluteCores = Math.abs(cores);
  if (absoluteCores < 0.1) {
    return THREE_DECIMAL_FORMATTER.format(cores);
  }
  if (absoluteCores < 1) {
    return TWO_DECIMAL_FORMATTER.format(cores);
  }
  return ONE_DECIMAL_FORMATTER.format(cores);
}

function formatCpuCapacity(capacity: string) {
  const cores = parseCpuCores(capacity);
  return cores === undefined ? capacity : formatCpuCores(cores);
}

function formatCpuReading(
  capacity: string | undefined,
  percent: number | undefined
) {
  if (capacity === undefined) {
    return "-- / --";
  }
  const formattedCapacity = formatCpuCapacity(capacity);
  const cores = parseCpuCores(capacity);
  if (cores === undefined || percent === undefined) {
    return `-- / ${formattedCapacity}`;
  }
  return `${formatCpuCores((cores * percent) / 100)} / ${formattedCapacity}`;
}

function parseMiQuantity(capacity: string | undefined) {
  if (capacity === undefined) {
    return undefined;
  }
  const match = STORAGE_QUANTITY_PATTERN.exec(capacity.trim());
  if (match === null) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  switch (match[2]?.toLowerCase()) {
    case "ki":
      return value / 1024;
    case "mi":
      return value;
    case "ti":
      return value * 1024 * 1024;
    case "gi":
    case undefined:
      return value * 1024;
    default:
      return undefined;
  }
}

function formatMi(valueMi: number) {
  if (valueMi > 0 && valueMi < 0.1) {
    return "<0.1Mi";
  }
  const formatter =
    Math.abs(valueMi) < 10 ? ONE_DECIMAL_FORMATTER : ZERO_DECIMAL_FORMATTER;
  return `${formatter.format(valueMi)}Mi`;
}

function formatBinaryQuantity(valueMi: number) {
  if (Math.abs(valueMi) < 1024) {
    return formatMi(valueMi);
  }
  return `${ONE_DECIMAL_FORMATTER.format(valueMi / 1024)}Gi`;
}

function formatQuantityReading(
  capacity: string | undefined,
  percent: number | undefined
) {
  if (capacity === undefined) {
    return "-- / --";
  }
  const capacityMi = parseMiQuantity(capacity);
  if (capacityMi === undefined) {
    return `-- / ${capacity}`;
  }
  const formattedCapacity = formatBinaryQuantity(capacityMi);
  if (percent === undefined) {
    return `-- / ${formattedCapacity}`;
  }
  return `${formatBinaryQuantity((capacityMi * percent) / 100)} / ${formattedCapacity}`;
}

export function metricReading({
  capacity,
  kind,
  percent,
}: {
  capacity: string | undefined;
  kind: DatabaseNodeMetricKey;
  percent: number | undefined;
}) {
  if (kind === "cpu") {
    return formatCpuReading(capacity, percent);
  }
  return formatQuantityReading(capacity, percent);
}
