"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigAuthHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { fetcher } from "../fetch";
import {
  type K8sGetResponse,
  k8sGetQuerySchema,
  k8sGetResponseSchema,
} from "../schemas/k8s-get";
import { ApiUrl } from "../utils";

export interface UseK8sGetResourceOptions {
  /** Resource short name / plural accepted by `kubectl get` mapping (e.g. `svc`, `pods`, `aps`). */
  kind: string;
  kubeconfig?: string;
  /** Object `metadata.name`. */
  name: string;
  /** Namespace for namespaced resources. */
  namespace: string;
  /** @default 0 */
  refreshInterval?: number;
}

/**
 * Fetches a single Kubernetes object via `GET /api/k8s/v1alpha1/get?kind=&name=&namespace=`.
 * Same auth rules as {@link useK8sNamespacedList}.
 */
export function useK8sGetResource(options: UseK8sGetResourceOptions) {
  const { kind, name, namespace } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const refreshInterval = options.refreshInterval ?? 0;

  const credentialKey = useMemo(
    () => kubeconfigCredentialKey(kubeconfig),
    [kubeconfig]
  );
  const authHeader = useMemo(
    (): Record<string, string> => kubeconfigAuthHeader(kubeconfig),
    [kubeconfig]
  );

  const getParams = useMemo(() => {
    const k = kind.trim();
    const n = name.trim();
    const ns = namespace.trim();
    if (k === "" || n === "" || ns === "") {
      return null;
    }
    return k8sGetQuerySchema.parse({ kind: k, name: n, namespace: ns });
  }, [kind, name, namespace]);

  const hasKubeconfig = kubeconfig.trim() !== "";

  const swrKey = (() => {
    if (getParams == null) {
      return null;
    }
    if (hasKubeconfig) {
      return [API_ROUTES.k8s.get, getParams, credentialKey] as const;
    }
    return null;
  })();

  return useSWR(
    swrKey,
    () =>
      fetcher<K8sGetResponse>({
        base: ApiUrl(),
        header: authHeader,
        method: "GET",
        path: API_ROUTES.k8s.get,
        query: getParams ?? undefined,
        select: (raw) => k8sGetResponseSchema.parse(raw),
      }),
    { refreshInterval }
  );
}
