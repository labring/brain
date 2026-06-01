"use client";

import { useCallback, useMemo, useState } from "react";

import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import {
  buildDbPublicAccessMergePatch,
  type DbPublicAccessPatchOptions,
} from "../lib/db-public-access-patch";
import { ApiUrl } from "../utils";

export interface UseDbLifecycleOptions {
  kubeconfig?: string;
}

export interface DbLifecycleWorkloadRef {
  /** DB `metadata.name`. */
  name: string;
  namespace: string;
}

export type DbLifecycleActionKey =
  | "delete"
  | "public-access"
  | "restart"
  | "start"
  | "stop";

export type DbPublicAccessPendingTarget = boolean | undefined;

function workloadKey(workload: DbLifecycleWorkloadRef): string {
  return `${workload.namespace.trim()}/${workload.name.trim()}`;
}

function workloadActionKey(
  workload: DbLifecycleWorkloadRef,
  action: DbLifecycleActionKey
): string {
  return `${workloadKey(workload)}:${action}`;
}

function validateWorkload(workload: DbLifecycleWorkloadRef): {
  name: string;
  namespace: string;
} {
  const name = workload.name.trim();
  const namespace = workload.namespace.trim();
  if (name === "" || namespace === "") {
    throw new Error("useDbLifecycle: workload name and namespace are required");
  }
  return { name, namespace };
}

function mergePatchDb(
  base: string,
  header: Record<string, string>,
  workload: DbLifecycleWorkloadRef,
  patch: object
): Promise<unknown> {
  const name = workload.name.trim();
  const namespace = workload.namespace.trim();
  if (name === "" || namespace === "") {
    return Promise.reject(
      new Error("useDbLifecycle: workload name and namespace are required")
    );
  }
  return fetcher<unknown>({
    base,
    body: patch,
    header,
    method: "PATCH",
    path: API_ROUTES.db.root,
    query: { name, namespace },
  });
}

/**
 * Imperative lifecycle for **example.crossplane.io/v1** `DB` workloads.
 *
 * - **Start/stop** → `POST /api/db/v1alpha1/start|stop`, patching `spec.paused`.
 * - **Restart** → `POST /api/db/v1alpha1/restart`, server-incrementing `spec.restartRequest`.
 * - **Delete** → claim DELETE, preserving terminationPolicy semantics.
 * - **Public access** → `spec.exposeNodePort` -> KubeBlocks NodePort Service reconciliation.
 */
export function useDbLifecycleOperations(options: UseDbLifecycleOptions) {
  const kubeconfig = options.kubeconfig ?? "";
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(() => new Set());
  const [publicAccessPendingTargets, setPublicAccessPendingTargets] = useState<
    Map<string, boolean>
  >(() => new Map());

  const headers = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );

  const authReady = kubeconfig.trim() !== "";

  const base = useMemo(() => ApiUrl(), []);

  const runWithLoading = useCallback(
    async (
      workload: DbLifecycleWorkloadRef,
      action: DbLifecycleActionKey,
      operation: () => Promise<unknown>
    ) => {
      const key = workloadActionKey(workload, action);
      setLoadingKeys((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        await operation();
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

  const isLoading = useCallback(
    (workload: DbLifecycleWorkloadRef, action: DbLifecycleActionKey) =>
      loadingKeys.has(workloadActionKey(workload, action)),
    [loadingKeys]
  );

  const isToggling = useCallback(
    (workload: DbLifecycleWorkloadRef) =>
      loadingKeys.has(workloadActionKey(workload, "public-access")) ||
      publicAccessPendingTargets.has(workloadKey(workload)),
    [loadingKeys, publicAccessPendingTargets]
  );

  const getPublicAccessPendingTarget = useCallback(
    (workload: DbLifecycleWorkloadRef): DbPublicAccessPendingTarget =>
      publicAccessPendingTargets.get(workloadKey(workload)),
    [publicAccessPendingTargets]
  );

  const clearPublicAccessPendingTarget = useCallback(
    (workload: DbLifecycleWorkloadRef) => {
      const key = workloadKey(workload);
      setPublicAccessPendingTargets((prev) => {
        if (!prev.has(key)) {
          return prev;
        }
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    },
    []
  );

  const assertAuthReady = useCallback(() => {
    if (!authReady) {
      throw new Error("useDbLifecycle: kubeconfig is required");
    }
  }, [authReady]);

  const startWorkload = useCallback(
    async (workload: DbLifecycleWorkloadRef) => {
      assertAuthReady();
      const body = validateWorkload(workload);
      await runWithLoading(workload, "start", () =>
        fetcher<unknown>({
          base,
          body,
          header: headers,
          method: "POST",
          path: API_ROUTES.db.start,
        })
      );
    },
    [assertAuthReady, base, headers, runWithLoading]
  );

  const stopWorkload = useCallback(
    async (workload: DbLifecycleWorkloadRef) => {
      assertAuthReady();
      const body = validateWorkload(workload);
      await runWithLoading(workload, "stop", () =>
        fetcher<unknown>({
          base,
          body,
          header: headers,
          method: "POST",
          path: API_ROUTES.db.stop,
        })
      );
    },
    [assertAuthReady, base, headers, runWithLoading]
  );

  const restartWorkload = useCallback(
    async (workload: DbLifecycleWorkloadRef) => {
      assertAuthReady();
      const body = validateWorkload(workload);
      await runWithLoading(workload, "restart", () =>
        fetcher<unknown>({
          base,
          body,
          header: headers,
          method: "POST",
          path: API_ROUTES.db.restart,
        })
      );
    },
    [assertAuthReady, base, headers, runWithLoading]
  );

  const deleteWorkload = useCallback(
    async (workload: DbLifecycleWorkloadRef) => {
      assertAuthReady();
      const { name, namespace } = validateWorkload(workload);
      await runWithLoading(workload, "delete", () =>
        fetcher<unknown>({
          base,
          header: headers,
          method: "DELETE",
          path: API_ROUTES.db.root,
          query: { name, namespace },
        })
      );
    },
    [assertAuthReady, base, headers, runWithLoading]
  );

  const togglePublicAccess = useCallback(
    async (
      workload: DbLifecycleWorkloadRef,
      nextEnabled: boolean,
      patchOptions?: DbPublicAccessPatchOptions
    ) => {
      assertAuthReady();
      validateWorkload(workload);
      setPublicAccessPendingTargets((prev) => {
        const key = workloadKey(workload);
        if (prev.get(key) === nextEnabled) {
          return prev;
        }
        const next = new Map(prev);
        next.set(key, nextEnabled);
        return next;
      });

      try {
        await runWithLoading(workload, "public-access", async () => {
          await mergePatchDb(
            base,
            headers,
            workload,
            buildDbPublicAccessMergePatch(nextEnabled, patchOptions)
          );
        });
      } catch (error) {
        clearPublicAccessPendingTarget(workload);
        throw error;
      }
    },
    [
      assertAuthReady,
      base,
      clearPublicAccessPendingTarget,
      headers,
      runWithLoading,
    ]
  );

  return {
    authReady,
    clearPublicAccessPendingTarget,
    deleteWorkload,
    getPublicAccessPendingTarget,
    isLoading,
    isToggling,
    restartWorkload,
    startWorkload,
    stopWorkload,
    togglePublicAccess,
  };
}
