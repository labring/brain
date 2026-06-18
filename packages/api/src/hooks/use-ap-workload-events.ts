"use client";

import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { type FetcherOptions, fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export interface APWorkloadEventsTarget {
  name: string;
  namespace: string;
}

export interface APWorkloadEventInvolvedObject {
  kind?: string;
  name?: string;
}

export interface APWorkloadEventItem {
  count?: number;
  firstTimestamp?: string;
  involvedObject: APWorkloadEventInvolvedObject;
  lastTimestamp?: string;
  message: string;
  reason: string;
  type?: string;
}

export interface APWorkloadEventsResponse {
  items: APWorkloadEventItem[];
  target: {
    kind: "AP";
    name: string;
    namespace: string;
  };
}

export type APWorkloadEventsFetchRequest = Omit<FetcherOptions, "base">;

export function buildAPWorkloadEventsRequest(options: {
  kubeconfig: string;
  limit?: number;
  target: APWorkloadEventsTarget;
}): APWorkloadEventsFetchRequest {
  return {
    header: {
      Authorization: kubeconfigBearerHeader(options.kubeconfig),
    },
    method: "GET",
    path: API_ROUTES.ap.events,
    query: {
      limit: options.limit,
      name: options.target.name,
      namespace: options.target.namespace,
    },
  };
}

export function useAPWorkloadEvents(options: {
  enabled?: boolean;
  kubeconfig?: string;
  limit?: number;
  /** @default 10_000 */
  refreshInterval?: number;
  target: APWorkloadEventsTarget | null;
}) {
  const { enabled = true, limit, refreshInterval = 10_000, target } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const hasKubeconfig = kubeconfig.trim() !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);
  const hasTarget =
    target !== null &&
    target.name.trim() !== "" &&
    target.namespace.trim() !== "";
  const shouldFetch = enabled && hasKubeconfig && hasTarget;
  const swrKey = shouldFetch
    ? ([API_ROUTES.ap.events, target, limit ?? null, credentialKey] as const)
    : null;

  return useSWR(
    swrKey,
    () => {
      if (target === null) {
        throw new Error("AP workload events target is required");
      }
      return fetcher<APWorkloadEventsResponse>({
        base: ApiUrl(),
        ...buildAPWorkloadEventsRequest({ kubeconfig, limit, target }),
      });
    },
    { refreshInterval }
  );
}
