"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { type K8sGetResponse, k8sGetResponseSchema } from "../schemas/k8s-get";
import { ApiUrl } from "../utils";

export type BrainProductResourceKind = "AP" | "DB";

export interface UseBrainProductResourceOptions {
  kind: BrainProductResourceKind;
  kubeconfig?: string;
  name: string;
  namespace: string;
  refreshInterval?: number;
}

function productRoute(kind: BrainProductResourceKind) {
  return kind === "DB" ? API_ROUTES.db.root : API_ROUTES.ap.root;
}

export function useBrainProductResource(
  options: UseBrainProductResourceOptions
) {
  const { kind, name, namespace } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const refreshInterval = options.refreshInterval ?? 0;
  const authHeader = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );
  const query = useMemo(() => {
    const n = name.trim();
    const ns = namespace.trim();
    if (n === "" || ns === "") {
      return null;
    }
    return { name: n, namespace: ns };
  }, [name, namespace]);
  const route = productRoute(kind);
  const swrKey =
    kubeconfig.trim() !== "" && query != null
      ? ([route, query] as const)
      : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<K8sGetResponse>({
        base: ApiUrl(),
        header: authHeader,
        method: "GET",
        path: route,
        query: query ?? undefined,
        select: (raw) => k8sGetResponseSchema.parse(raw),
      }),
    { refreshInterval }
  );
}
