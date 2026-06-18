"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { type FetcherOptions, fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export type WorkloadTelemetrySnapshotKind = "ap" | "db";
export type WorkloadTelemetrySnapshotMetricKey = "cpu" | "memory" | "storage";

export interface WorkloadTelemetrySnapshotTarget {
  kind: WorkloadTelemetrySnapshotKind;
  name: string;
  namespace: string;
}

export interface WorkloadTelemetrySnapshotMetric {
  value: number;
}

export interface WorkloadTelemetrySnapshotError {
  code: string;
  message: string;
}

export interface WorkloadTelemetrySnapshotItem {
  error?: WorkloadTelemetrySnapshotError;
  metricErrors?: Partial<
    Record<WorkloadTelemetrySnapshotMetricKey, WorkloadTelemetrySnapshotError>
  >;
  metrics?: Partial<
    Record<WorkloadTelemetrySnapshotMetricKey, WorkloadTelemetrySnapshotMetric>
  >;
  sampledAt?: string;
  target: WorkloadTelemetrySnapshotTarget;
}

export interface WorkloadTelemetrySnapshotResponse {
  items: WorkloadTelemetrySnapshotItem[];
}

export interface WorkloadTelemetrySnapshotRequest {
  body: { targets: WorkloadTelemetrySnapshotTarget[] };
  credentialKey: string;
  enabled: boolean;
  header: Record<string, string>;
  method: Extract<FetcherOptions["method"], "POST">;
  path: string;
}

export function buildWorkloadTelemetrySnapshotRequest(options: {
  kubeconfig?: string;
  targets: WorkloadTelemetrySnapshotTarget[];
}): WorkloadTelemetrySnapshotRequest {
  const kubeconfig = options.kubeconfig ?? "";
  const targets = options.targets;

  return {
    body: { targets },
    credentialKey: kubeconfigCredentialKey(kubeconfig),
    enabled: kubeconfig.trim() !== "" && targets.length > 0,
    header: { Authorization: kubeconfigBearerHeader(kubeconfig) },
    method: "POST",
    path: API_ROUTES.telemetry.metricsSnapshot,
  };
}

export function useWorkloadTelemetrySnapshotBatch(options: {
  kubeconfig?: string;
  /** @default 5000 */
  refreshInterval?: number;
  targets: WorkloadTelemetrySnapshotTarget[];
}) {
  const { refreshInterval = 5000, targets } = options;
  const request = useMemo(
    () =>
      buildWorkloadTelemetrySnapshotRequest({
        kubeconfig: options.kubeconfig,
        targets,
      }),
    [options.kubeconfig, targets]
  );

  return useSWR(
    request.enabled
      ? ([request.path, request.body.targets, request.credentialKey] as const)
      : null,
    () =>
      fetcher<WorkloadTelemetrySnapshotResponse>({
        base: ApiUrl(),
        body: request.body,
        header: request.header,
        method: request.method,
        path: request.path,
      }),
    { refreshInterval }
  );
}
