"use client";

import { useCallback } from "react";

import { API_ROUTES } from "../constants";
import { ApiUrl } from "../utils";
import type { DbLifecycleWorkloadRef } from "./use-db-lifecycle";

export type DbConnectionStringKind = "private" | "public";

export interface UseDbConnectionStringResolverOptions {
  kubeconfig?: string;
}

/**
 * Resolves the complete DB Connection DSN for one DB Service on demand.
 *
 * Default DB read responses carry credential-free DB Connection Templates
 * (ADR-0053); this resolver backs the explicit reveal and copy actions,
 * mirroring the AP env-value resolve pattern: fetched only on user action,
 * never cached (`no-store` on both request and response).
 */
export function useDbConnectionStringResolver(
  options: UseDbConnectionStringResolverOptions
) {
  const kubeconfig = (options.kubeconfig ?? "").trim();
  const authReady = kubeconfig !== "";

  const resolveConnectionString = useCallback(
    async (
      workload: DbLifecycleWorkloadRef,
      kind: DbConnectionStringKind
    ): Promise<string> => {
      const name = workload.name.trim();
      const namespace = workload.namespace.trim();
      if (kubeconfig === "" || name === "" || namespace === "") {
        throw new Error("Connection string reveal is unavailable.");
      }
      const url = new URL(API_ROUTES.db.connectionString, ApiUrl());
      url.searchParams.set("name", name);
      url.searchParams.set("namespace", namespace);
      url.searchParams.set("kind", kind);
      const response = await fetch(url.toString(), {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
        },
        method: "GET",
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const body = (await response.json()) as { value?: unknown };
      return typeof body.value === "string" ? body.value : "";
    },
    [kubeconfig]
  );

  return { authReady, resolveConnectionString };
}
