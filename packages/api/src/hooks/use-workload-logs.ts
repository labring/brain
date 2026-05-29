"use client";

import useSWR from "swr";
import { API_ROUTES } from "../constants";
import { type FetcherOptions, fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export type WorkloadLogsKind = "ap" | "db";

export interface WorkloadLogsTarget {
  kind: WorkloadLogsKind;
  name: string;
  namespace: string;
}

export interface WorkloadLogEntry {
  container?: string;
  message?: string;
  node?: string;
  pod?: string;
  stream?: string;
  time?: string;
  [key: string]: unknown;
}

export type WorkloadLogsResponse = Record<string, WorkloadLogEntry[]>;

export type WorkloadLogsFetchRequest = Omit<FetcherOptions, "base">;

export interface WorkloadLogsWindow {
  end: Date;
  start: Date;
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function buildWorkloadLogsRequest(options: {
  container?: string;
  kubeconfig: string;
  limit?: number;
  search?: string;
  target: WorkloadLogsTarget;
  window: WorkloadLogsWindow;
}): WorkloadLogsFetchRequest {
  return {
    header: {
      Authorization: `Bearer ${encodeURIComponent(options.kubeconfig)}`,
    },
    method: "GET",
    path: API_ROUTES.telemetry.logs,
    query: {
      container: options.container,
      end: unixSeconds(options.window.end),
      kind: options.target.kind,
      limit: options.limit,
      name: options.target.name,
      namespace: options.target.namespace,
      search: options.search,
      start: unixSeconds(options.window.start),
    },
  };
}

export function useWorkloadLogs(options: {
  container?: string;
  enabled?: boolean;
  getWindow: () => WorkloadLogsWindow;
  kubeconfig?: string;
  limit?: number;
  search?: string;
  target: WorkloadLogsTarget | null;
  windowKey: string;
}) {
  const {
    container,
    enabled = true,
    getWindow,
    limit,
    search,
    target,
    windowKey,
  } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const hasKubeconfig = kubeconfig.trim() !== "";
  const hasTarget =
    target !== null &&
    target.name.trim() !== "" &&
    target.namespace.trim() !== "";
  const trimmedSearch = search?.trim();
  const shouldFetch = enabled && hasKubeconfig && hasTarget;
  const swrKey = shouldFetch
    ? ([
        API_ROUTES.telemetry.logs,
        target,
        container ?? null,
        limit ?? null,
        trimmedSearch ?? "",
        windowKey,
      ] as const)
    : null;

  return useSWR(
    swrKey,
    () => {
      if (target === null) {
        throw new Error("workload logs target is required");
      }
      return fetcher<WorkloadLogsResponse>({
        base: ApiUrl(),
        ...buildWorkloadLogsRequest({
          container,
          kubeconfig,
          limit,
          search: trimmedSearch,
          target,
          window: getWindow(),
        }),
      });
    },
    { refreshInterval: 0 }
  );
}
