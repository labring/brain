"use client";

import { useCallback, useMemo } from "react";

import { API_ROUTES } from "../constants";
import { fetcher } from "../fetch";
import { ApiUrl } from "../utils";

export interface UseApLifecycleOptions {
  kubeconfig?: string;
}

export interface ApLifecycleWorkloadRef {
  /** AP `metadata.name`. */
  name: string;
  namespace: string;
}

function mergePatchAp(
  base: string,
  header: Record<string, string>,
  workload: ApLifecycleWorkloadRef,
  patch: Record<string, unknown>
): Promise<unknown> {
  const name = workload.name.trim();
  const namespace = workload.namespace.trim();
  if (name === "" || namespace === "") {
    return Promise.reject(
      new Error("useApLifecycle: workload name and namespace are required")
    );
  }
  return fetcher<unknown>({
    base,
    body: patch,
    header,
    method: "PATCH",
    path: API_ROUTES.ap.root,
    query: { name, namespace },
  });
}

/** Imperative lifecycle for Brain AP product views backed by direct Kubernetes Deployments. */
export function useApLifecycleOperations(options: UseApLifecycleOptions) {
  const kubeconfig = options.kubeconfig ?? "";

  const headers = useMemo(
    (): Record<string, string> => ({
      Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
    }),
    [kubeconfig]
  );

  const authReady = kubeconfig.trim() !== "";

  const base = useMemo(() => ApiUrl(), []);

  const pauseWorkload = useCallback(
    async (workload: ApLifecycleWorkloadRef) => {
      if (!authReady) {
        throw new Error("useApLifecycle: kubeconfig is required");
      }
      await mergePatchAp(base, headers, workload, {
        spec: { paused: true },
      });
    },
    [authReady, base, headers]
  );

  const startWorkload = useCallback(
    async (workload: ApLifecycleWorkloadRef) => {
      if (!authReady) {
        throw new Error("useApLifecycle: kubeconfig is required");
      }
      await mergePatchAp(base, headers, workload, {
        spec: { paused: false },
      });
    },
    [authReady, base, headers]
  );

  /** Rolling restart of the backing Deployment with the same name as the AP. */
  const restartWorkload = useCallback(
    async (workload: ApLifecycleWorkloadRef) => {
      if (!authReady) {
        throw new Error("useApLifecycle: kubeconfig is required");
      }
      const name = workload.name.trim();
      const namespace = workload.namespace.trim();
      if (name === "" || namespace === "") {
        throw new Error(
          "useApLifecycle: workload name and namespace are required"
        );
      }
      await fetcher<unknown>({
        base,
        body: {
          name,
          namespace,
        },
        header: headers,
        method: "POST",
        path: API_ROUTES.ap.restart,
      });
    },
    [authReady, base, headers]
  );

  /** Sends a restartRequest patch for callers that still keep a client-side restart nonce. */
  const bumpRestartRequest = useCallback(
    async (workload: ApLifecycleWorkloadRef, nextNonce: number) => {
      if (!authReady) {
        throw new Error("useApLifecycle: kubeconfig is required");
      }
      if (!Number.isFinite(nextNonce) || nextNonce < 0) {
        throw new Error(
          "useApLifecycle: restartRequest must be a non-negative integer"
        );
      }
      await mergePatchAp(base, headers, workload, {
        spec: { restartRequest: nextNonce },
      });
    },
    [authReady, base, headers]
  );

  const deleteWorkload = useCallback(
    async (workload: ApLifecycleWorkloadRef) => {
      if (!authReady) {
        throw new Error("useApLifecycle: kubeconfig is required");
      }
      const name = workload.name.trim();
      const namespace = workload.namespace.trim();
      if (name === "" || namespace === "") {
        throw new Error(
          "useApLifecycle: workload name and namespace are required"
        );
      }
      await fetcher<unknown>({
        base,
        header: headers,
        method: "DELETE",
        path: API_ROUTES.ap.root,
        query: { name, namespace },
      });
    },
    [authReady, base, headers]
  );

  return {
    authReady,
    bumpRestartRequest,
    deleteWorkload,
    pauseWorkload,
    restartWorkload,
    startWorkload,
  };
}
