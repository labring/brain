"use client";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import {
  isEffectivelyVisible,
  subscribeEffectiveVisibility,
} from "@workspace/ui/lib/effective-visibility";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import {
  createWorkloadTelemetryStore,
  type WorkloadTelemetrySnapshotResponse,
  type WorkloadTelemetrySnapshotState,
  type WorkloadTelemetryStore,
  type WorkloadTelemetryTarget,
} from "./workload-telemetry-store";

const EMPTY_SNAPSHOT_STATE: WorkloadTelemetrySnapshotState = {};

const WorkloadTelemetryContext = createContext<WorkloadTelemetryStore | null>(
  null
);

export interface WorkloadTelemetryProviderProps {
  children: ReactNode;
  kubeconfig: string;
  refreshIntervalMs?: number;
}

export function WorkloadTelemetryProvider({
  children,
  kubeconfig,
  refreshIntervalMs = 5000,
}: WorkloadTelemetryProviderProps) {
  const store = useMemo(
    () =>
      createWorkloadTelemetryStore({
        autoRefresh: true,
        fetchSnapshot: (targets) =>
          fetcher<WorkloadTelemetrySnapshotResponse>({
            base: ApiUrl(),
            body: { targets },
            header: {
              Authorization: `Bearer ${encodeURIComponent(kubeconfig)}`,
            },
            method: "POST",
            path: API_ROUTES.telemetry.metricsSnapshot,
          }),
      }),
    [kubeconfig]
  );
  useEffect(() => {
    if (refreshIntervalMs <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      // Skip while the tab or the embedding desktop window hides the app.
      if (!(isEffectivelyVisible() && store.hasActiveTargets())) {
        return;
      }
      store.refresh().catch(() => undefined);
    }, refreshIntervalMs);
    const unsubscribe = subscribeEffectiveVisibility((visible) => {
      if (visible && store.hasActiveTargets()) {
        store.refresh().catch(() => undefined);
      }
    });
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, [refreshIntervalMs, store]);

  return (
    <WorkloadTelemetryContext value={store}>
      {children}
    </WorkloadTelemetryContext>
  );
}

export function useWorkloadTelemetrySnapshot(
  target: WorkloadTelemetryTarget | null
): WorkloadTelemetrySnapshotState {
  const store = useContext(WorkloadTelemetryContext);
  const targetKind = target?.kind ?? null;
  const targetName = target?.name ?? "";
  const targetNamespace = target?.namespace ?? "";

  const currentTarget = useCallback((): WorkloadTelemetryTarget | null => {
    if (targetKind === null) {
      return null;
    }
    return {
      kind: targetKind,
      name: targetName,
      namespace: targetNamespace,
    };
  }, [targetKind, targetName, targetNamespace]);

  const subscribe = useCallback(
    (listener: () => void) => {
      const nextTarget = currentTarget();
      if (store === null || nextTarget === null) {
        return () => undefined;
      }
      return store.subscribe(nextTarget, listener);
    },
    [currentTarget, store]
  );

  const getSnapshot = useCallback(() => {
    const nextTarget = currentTarget();
    if (store === null || nextTarget === null) {
      return EMPTY_SNAPSHOT_STATE;
    }
    return store.getSnapshot(nextTarget);
  }, [currentTarget, store]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_SNAPSHOT_STATE
  );
}
