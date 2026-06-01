"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { apItemsFromList } from "../lib/ap-list";
import {
  type K8sGetResponse,
  k8sGetQuerySchema,
  k8sGetResponseSchema,
} from "../schemas/k8s-get";
import { ApiUrl } from "../utils";

export type K8sNamespacedListRefreshInterval =
  | number
  | ((latestData: K8sGetResponse | undefined) => number);

function resolveRefreshInterval(
  refreshInterval: K8sNamespacedListRefreshInterval | undefined,
  latestData: K8sGetResponse | undefined
) {
  if (typeof refreshInterval === "function") {
    return refreshInterval(latestData);
  }
  return refreshInterval ?? 0;
}

function minPositiveInterval(a: number, b: number) {
  if (a > 0 && b > 0) {
    return Math.min(a, b);
  }
  return a > 0 ? a : b;
}

/** Plural k8s resource short name as accepted by `GET /api/k8s/.../get` (e.g. `aps`, `dbs`). */
export function useK8sNamespacedList(options: {
  kind: string;
  kubeconfig?: string;
  labelSelector: string;
  namespace?: string;
  pollWhileEmpty?: boolean;
  /**
   * With `pollWhileEmpty`, used to coordinate two lists: fast poll only if this list is empty **and**
   * `peerEmpty()` is true (e.g. 1s interval only while both AP and DB lists are still empty).
   */
  peerEmpty?: () => boolean;
  /** Additional SWR refresh cadence. Combined with empty-list polling by choosing the faster active interval. */
  refreshInterval?: K8sNamespacedListRefreshInterval;
}) {
  const { kind, labelSelector, namespace, refreshInterval } = options;
  const pollWhileEmpty = options.pollWhileEmpty === true;
  const peerEmpty = options.peerEmpty;
  const kubeconfig = options.kubeconfig ?? "";

  const authHeader = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );

  const getParams = useMemo(
    () =>
      k8sGetQuerySchema.parse({
        kind,
        "label-selector": labelSelector,
        ...(namespace ? { namespace } : {}),
      }),
    [kind, labelSelector, namespace]
  );

  const hasKubeconfig = kubeconfig.trim() !== "";

  const swrKey = hasKubeconfig
    ? ([API_ROUTES.k8s.get, getParams] as const)
    : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<K8sGetResponse>({
        base: ApiUrl(),
        path: API_ROUTES.k8s.get,
        query: getParams,
        header: authHeader,
        method: "GET",
        select: (raw) => k8sGetResponseSchema.parse(raw),
      }),
    {
      refreshInterval: (latestData) => {
        const configuredInterval = resolveRefreshInterval(
          refreshInterval,
          latestData
        );
        if (!pollWhileEmpty) {
          return configuredInterval;
        }
        let emptyInterval = 0;
        if (apItemsFromList(latestData).length > 0) {
          return configuredInterval;
        }
        if (peerEmpty == null || peerEmpty()) {
          emptyInterval = 1000;
        }
        return minPositiveInterval(configuredInterval, emptyInterval);
      },
    }
  );
}
