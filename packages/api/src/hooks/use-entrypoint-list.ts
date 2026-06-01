"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { apItemsFromList } from "../lib/ap-list";
import { type K8sGetResponse, k8sGetResponseSchema } from "../schemas/k8s-get";
import { ApiUrl } from "../utils";
import type { K8sNamespacedListRefreshInterval } from "./use-k8s-namespaced-list";

function resolveRefreshInterval(
  refreshInterval: K8sNamespacedListRefreshInterval | undefined,
  latestData: K8sGetResponse | undefined
) {
  if (typeof refreshInterval === "function") {
    return refreshInterval(latestData);
  }
  return refreshInterval ?? 0;
}

export function useEntryPointList(options: {
  kubeconfig?: string;
  labelSelector?: string;
  namespace?: string;
  pollWhileEmpty?: boolean;
  refreshInterval?: K8sNamespacedListRefreshInterval;
}) {
  const {
    kubeconfig = "",
    labelSelector,
    namespace,
    pollWhileEmpty,
    refreshInterval,
  } = options;

  const authHeader = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );
  const query = useMemo(
    () => ({
      ...(labelSelector ? { "label-selector": labelSelector } : {}),
      ...(namespace ? { namespace } : {}),
    }),
    [labelSelector, namespace]
  );
  const hasKubeconfig = kubeconfig.trim() !== "";
  const swrKey = hasKubeconfig
    ? ([API_ROUTES.entrypoint.root, query] as const)
    : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<K8sGetResponse>({
        base: ApiUrl(),
        header: authHeader,
        method: "GET",
        path: API_ROUTES.entrypoint.root,
        query,
        select: (raw) => k8sGetResponseSchema.parse(raw),
      }),
    {
      refreshInterval: (latestData) => {
        const configuredInterval = resolveRefreshInterval(
          refreshInterval,
          latestData
        );
        if (!pollWhileEmpty || apItemsFromList(latestData).length > 0) {
          return configuredInterval;
        }
        return configuredInterval > 0
          ? Math.min(configuredInterval, 1000)
          : 1000;
      },
    }
  );
}
