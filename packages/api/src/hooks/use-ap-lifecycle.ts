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

/**
 * Imperative lifecycle for **example.crossplane.io/v1** `AP` workloads composed as a Deployment:
 * pause/start via `spec.paused`, restart via rollout on the Deployment, delete via DELETE.
 *
 * Mirrors:
 * - **Pause/start** → Crossplane merges `spec.paused`; composition `aps-deployment-ingress-go-templating`
 *   scales the Deployment with SealOS-style annotations (`packages/crossplane/public/service/ap/*.yaml`).
 * - **Restart** → `POST /api/ap/v1alpha1/restart` (kubectl-style `kubectl.kubernetes.io/restartedAt` patch).
 */
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

  /**
   * Rolling restart of the composed Deployment (same name as the AP). Does not increment
   * `spec.restartRequest`; use {@link bumpRestartRequest} if you need a GitOps-only signal on the AP.
   */
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

  /**
   * Bumps **`spec.restartRequest`** so the Composition changes the Deployment pod template (`restartNonce` label).
   * Requires reading the current value first unless you maintain a counter client-side.
   */
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
