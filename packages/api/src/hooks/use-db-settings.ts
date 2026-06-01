"use client";

import { useCallback, useMemo, useState } from "react";

import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { ApiUrl } from "../utils";
import type {
  DbLifecycleWorkloadRef,
  UseDbLifecycleOptions,
} from "./use-db-lifecycle";

function validateWorkload(workload: DbLifecycleWorkloadRef): {
  name: string;
  namespace: string;
} {
  const name = workload.name.trim();
  const namespace = workload.namespace.trim();
  if (name === "" || namespace === "") {
    throw new Error("useDbSettings: workload name and namespace are required");
  }
  return { name, namespace };
}

function workloadKey(workload: DbLifecycleWorkloadRef): string {
  return `${workload.namespace.trim()}/${workload.name.trim()}`;
}

export function useDbSettingsOperations(options: UseDbLifecycleOptions) {
  const kubeconfig = options.kubeconfig ?? "";
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());

  const headers = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );

  const authReady = kubeconfig.trim() !== "";
  const base = useMemo(() => ApiUrl(), []);

  const assertAuthReady = useCallback(() => {
    if (!authReady) {
      throw new Error("useDbSettings: kubeconfig is required");
    }
  }, [authReady]);

  const runWithLoading = useCallback(
    async <T>(
      workload: DbLifecycleWorkloadRef,
      operation: () => Promise<T>
    ): Promise<T> => {
      const key = workloadKey(workload);
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        return await operation();
      } finally {
        setLoadingKeys((prev) => {
          if (!prev.has(key)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    []
  );

  const isUpdating = useCallback(
    (workload: DbLifecycleWorkloadRef) =>
      loadingKeys.has(workloadKey(workload)),
    [loadingKeys]
  );

  const updateSettings = useCallback(
    (workload: DbLifecycleWorkloadRef, patch: object): Promise<unknown> => {
      assertAuthReady();
      const { name, namespace } = validateWorkload(workload);
      return runWithLoading(workload, () =>
        fetcher<unknown>({
          base,
          body: patch,
          header: headers,
          method: "PATCH",
          path: API_ROUTES.db.root,
          query: { name, namespace },
        })
      );
    },
    [assertAuthReady, base, headers, runWithLoading]
  );

  return {
    authReady,
    isUpdating,
    updateSettings,
  };
}
