export type MetricTrend = "falling" | "rising" | "stable";

export interface MetricTrendPoint {
  timestamp: number;
  value: number;
}

export interface MetricTrendOptions {
  priorWindowSize?: number;
  threshold?: number;
  trailingWindowSize?: number;
}

const DEFAULT_PRIOR_WINDOW_SIZE = 6;
const DEFAULT_THRESHOLD = 5;
const DEFAULT_TRAILING_WINDOW_SIZE = 3;

function mean(points: readonly MetricTrendPoint[]): number {
  if (points.length === 0) {
    return Number.NaN;
  }
  return points.reduce((sum, point) => sum + point.value, 0) / points.length;
}

export function computeMetricTrend(
  series: readonly MetricTrendPoint[],
  options?: MetricTrendOptions
): MetricTrend {
  if (series.length < 2) {
    return "stable";
  }

  const trailingWindowSize =
    options?.trailingWindowSize ?? DEFAULT_TRAILING_WINDOW_SIZE;
  const priorWindowSize = options?.priorWindowSize ?? DEFAULT_PRIOR_WINDOW_SIZE;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const ordered = [...series].sort((a, b) => a.timestamp - b.timestamp);
  const trailing = ordered.slice(-trailingWindowSize);
  const prior = ordered.slice(
    Math.max(0, ordered.length - trailingWindowSize - priorWindowSize),
    Math.max(0, ordered.length - trailingWindowSize)
  );
  const delta = mean(trailing) - mean(prior);

  if (!Number.isFinite(delta)) {
    return "stable";
  }
  if (delta > threshold) {
    return "rising";
  }
  if (delta < -threshold) {
    return "falling";
  }
  return "stable";
}
