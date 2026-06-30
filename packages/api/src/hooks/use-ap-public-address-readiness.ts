"use client";

import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigAuthHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export interface APPublicAddressReadinessTarget {
  name: string;
  namespace: string;
}

export interface APPublicAddressReadinessItem {
  error?: string;
  ready: boolean;
  url: string;
}

export function useAPPublicAddressReadiness(options: {
  enabled?: boolean;
  kubeconfig?: string;
  /** @default 10_000 */
  refreshInterval?: number;
  target: APPublicAddressReadinessTarget | null;
}) {
  const { enabled = true, refreshInterval = 10_000, target } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const hasKubeconfig = kubeconfig.trim() !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);
  const hasTarget =
    target !== null &&
    target.name.trim() !== "" &&
    target.namespace.trim() !== "";
  const shouldFetch = enabled && hasKubeconfig && hasTarget;
  const swrKey = shouldFetch
    ? ([API_ROUTES.ap.checkReady, target, credentialKey] as const)
    : null;

  return useSWR(
    swrKey,
    () => {
      if (target === null) {
        throw new Error("AP public address readiness target is required");
      }
      return fetcher<APPublicAddressReadinessItem[]>({
        base: ApiUrl(),
        header: kubeconfigAuthHeader(kubeconfig),
        method: "GET",
        path: API_ROUTES.ap.checkReady,
        query: {
          name: target.name,
          namespace: target.namespace,
        },
      });
    },
    { refreshInterval }
  );
}
