import type { MetricsData } from "@workspace/ui/components/metrics-chart/metrics-chart.types";

function rowTimeUnix(row: Record<string, number | string>): number {
  const t = row.time;
  if (typeof t === "number") {
    return t;
  }
  if (typeof t === "string") {
    return Number(t);
  }
  return Number.NaN;
}

function numericCell(v: number | string): number | undefined {
  const num = typeof v === "number" ? v : Number(v);
  return Number.isFinite(num) ? num : undefined;
}

/** Turns flattened API rows (`time`, `cpu`, `memory`, …) into {@link MetricsData} for {@link MetricsPane}. */
export function telemetryRowsToMetricsData(
  rows: Record<string, number | string>[] | undefined
): MetricsData {
  if (rows == null || rows.length === 0) {
    return {};
  }
  const byKey = new Map<string, { timestamp: number; value: number }[]>();

  for (const row of rows) {
    const ts = rowTimeUnix(row);
    if (!Number.isFinite(ts)) {
      continue;
    }
    for (const [k, v] of Object.entries(row)) {
      if (k === "time") {
        continue;
      }
      const num = numericCell(v);
      if (num === undefined) {
        continue;
      }
      let arr = byKey.get(k);
      if (arr == null) {
        arr = [];
        byKey.set(k, arr);
      }
      arr.push({ timestamp: ts, value: num });
    }
  }

  const out: MetricsData = {};
  for (const [k, arr] of byKey) {
    arr.sort((a, b) => a.timestamp - b.timestamp);
    out[k] = arr;
  }
  return out;
}
