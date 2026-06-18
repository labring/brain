"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigAuthHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { fetcher } from "../fetch";
import { apItemsFromList } from "../lib/ap-list";
import { type K8sGetResponse, k8sGetResponseSchema } from "../schemas/k8s-get";
import { ApiUrl } from "../utils";
import type {
  K8sNamespacedListRefreshInterval,
  UseK8sNamespacedListOptions,
} from "./use-k8s-namespaced-list";

export type UseDbsK8sListOptions = Omit<UseK8sNamespacedListOptions, "kind">;

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

export function useDbsK8sList(options: UseDbsK8sListOptions) {
  const {
    kubeconfig = "",
    labelSelector,
    namespace,
    refreshInterval,
  } = options;
  const pollWhileEmpty = options.pollWhileEmpty === true;
  const peerEmpty = options.peerEmpty;
  const credentialKey = useMemo(
    () => kubeconfigCredentialKey(kubeconfig),
    [kubeconfig]
  );
  const authHeader = useMemo(
    (): Record<string, string> => kubeconfigAuthHeader(kubeconfig),
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
    ? ([API_ROUTES.db.root, query, credentialKey] as const)
    : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<K8sGetResponse>({
        base: ApiUrl(),
        header: authHeader,
        method: "GET",
        path: API_ROUTES.db.root,
        query,
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
