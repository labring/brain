"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export interface APImageVersionItem {
  active: boolean;
  apName: string;
  createdAt: string;
  image: string;
  imagePullPolicy?: string;
  namespace: string;
  source: string;
  specSnapshot?: Record<string, unknown>;
  versionHash: string;
}

export interface APImageVersionsResponse {
  items: APImageVersionItem[];
}

export interface APImageVersionTarget {
  kubeconfig?: string;
  name: string;
  namespace: string;
}

function authHeader(kubeconfig: string): Record<string, string> {
  return { Authorization: `Bearer ${encodeURIComponent(kubeconfig)}` };
}

function versionQuery(target: APImageVersionTarget) {
  const name = target.name.trim();
  const namespace = target.namespace.trim();
  if (name === "" || namespace === "") {
    return null;
  }
  return { name, namespace };
}

export function useAPImageVersions(target: APImageVersionTarget) {
  const name = target.name.trim();
  const namespace = target.namespace.trim();
  const kubeconfig = target.kubeconfig ?? "";
  const query = useMemo(
    () => versionQuery({ name, namespace }),
    [name, namespace]
  );
  const swrKey =
    kubeconfig.trim() !== "" && query != null
      ? ([API_ROUTES.ap.versions, query] as const)
      : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<APImageVersionsResponse>({
        base: ApiUrl(),
        header: authHeader(kubeconfig),
        method: "GET",
        path: API_ROUTES.ap.versions,
        query: query ?? undefined,
      }),
    { refreshInterval: 0 }
  );
}

export function fetchAPImageVersionDetail(
  target: APImageVersionTarget & { versionHash: string }
): Promise<APImageVersionItem> {
  const kubeconfig = target.kubeconfig ?? "";
  const query = versionQuery(target);
  if (query == null) {
    throw new Error("AP name and namespace are required.");
  }
  return fetcher<APImageVersionItem>({
    base: ApiUrl(),
    header: authHeader(kubeconfig),
    method: "GET",
    path: `${API_ROUTES.ap.versions}/${encodeURIComponent(target.versionHash)}`,
    query,
  });
}

export function rollbackAPImageVersion(
  target: APImageVersionTarget & { versionHash: string }
): Promise<unknown> {
  const kubeconfig = target.kubeconfig ?? "";
  const query = versionQuery(target);
  if (query == null) {
    throw new Error("AP name and namespace are required.");
  }
  return fetcher({
    base: ApiUrl(),
    header: authHeader(kubeconfig),
    method: "POST",
    path: `${API_ROUTES.ap.versions}/${encodeURIComponent(target.versionHash)}/rollback`,
    query,
  });
}
