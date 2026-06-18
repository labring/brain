"use client";

import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { type FetcherOptions, fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export type WorkloadTelemetrySeriesKind = "ap" | "db";
export type WorkloadTelemetrySeriesMetricKey = "cpu" | "memory" | "storage";

export interface WorkloadTelemetrySeriesTarget {
  kind: WorkloadTelemetrySeriesKind;
  name: string;
  namespace: string;
}

export type WorkloadTelemetrySeriesRow = { time: number } & Partial<
  Record<WorkloadTelemetrySeriesMetricKey, number>
>;

export interface WorkloadTelemetrySeriesError {
  code: string;
  message: string;
}

export interface WorkloadTelemetrySeriesResponse {
  metricErrors?: Partial<
    Record<WorkloadTelemetrySeriesMetricKey, WorkloadTelemetrySeriesError>
  >;
  rows: WorkloadTelemetrySeriesRow[];
  target: WorkloadTelemetrySeriesTarget;
}

export type WorkloadTelemetrySeriesFetchRequest = Omit<FetcherOptions, "base">;

export interface WorkloadTelemetrySeriesWindow {
  end: Date;
  start: Date;
  stepSeconds: number;
}

export function buildWorkloadTelemetrySeriesRequest(options: {
  end: Date;
  kubeconfig: string;
  start: Date;
  stepSeconds: number;
  target: WorkloadTelemetrySeriesTarget;
}): WorkloadTelemetrySeriesFetchRequest {
  const stepSeconds = Math.max(0, Math.round(options.stepSeconds));
  return {
    body: {
      end: options.end.toISOString(),
      start: options.start.toISOString(),
      step: `${stepSeconds}s`,
      target: options.target,
    },
    header: {
      Authorization: kubeconfigBearerHeader(options.kubeconfig),
    },
    method: "POST",
    path: API_ROUTES.telemetry.metricsSeries,
  };
}

export function useWorkloadTelemetrySeries(options: {
  enabled?: boolean;
  getWindow: () => WorkloadTelemetrySeriesWindow;
  kubeconfig?: string;
  /** @default 5000 */
  refreshInterval?: number;
  target: WorkloadTelemetrySeriesTarget | null;
  windowKey: string;
}) {
  const {
    enabled = true,
    getWindow,
    refreshInterval = 5000,
    target,
    windowKey,
  } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const hasKubeconfig = kubeconfig.trim() !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);
  const shouldFetch = enabled && hasKubeconfig && target !== null;
  const swrKey = shouldFetch
    ? ([
        API_ROUTES.telemetry.metricsSeries,
        target,
        windowKey,
        credentialKey,
      ] as const)
    : null;

  return useSWR(
    swrKey,
    () => {
      if (target === null) {
        throw new Error("workload telemetry series target is required");
      }
      const window = getWindow();
      return fetcher<WorkloadTelemetrySeriesResponse>({
        base: ApiUrl(),
        ...buildWorkloadTelemetrySeriesRequest({
          end: window.end,
          kubeconfig,
          start: window.start,
          stepSeconds: window.stepSeconds,
          target,
        }),
      });
    },
    { refreshInterval }
  );
}
