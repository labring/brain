"use client";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
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

const EMPTY_SNAPSHOT_STATE: WorkloadTelemetrySnapshotState = {
  refreshing: false,
};

const WorkloadTelemetryContext = createContext<WorkloadTelemetryStore | null>(
  null
);

export interface WorkloadTelemetryProviderProps {
  children: ReactNode;
  kubeconfig: string;
  refreshIntervalMs?: number;
  selectedTarget?: WorkloadTelemetryTarget | null;
}

export function WorkloadTelemetryProvider({
  children,
  kubeconfig,
  refreshIntervalMs = 5000,
  selectedTarget = null,
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
  const selectedKind = selectedTarget?.kind ?? null;
  const selectedName = selectedTarget?.name ?? "";
  const selectedNamespace = selectedTarget?.namespace ?? "";

  useEffect(() => {
    const nextSelectedTarget =
      selectedKind === null
        ? null
        : {
            kind: selectedKind,
            name: selectedName,
            namespace: selectedNamespace,
          };
    store.setSelectedTarget(nextSelectedTarget);
    if (nextSelectedTarget !== null) {
      store.refresh().catch(() => undefined);
    }
  }, [selectedKind, selectedName, selectedNamespace, store]);

  useEffect(() => {
    if (refreshIntervalMs <= 0) {
      return;
    }
    const id = window.setInterval(() => {
      store.refresh().catch(() => undefined);
    }, refreshIntervalMs);
    return () => window.clearInterval(id);
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
