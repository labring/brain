export type WorkloadTelemetryKind = "ap" | "db";

export type WorkloadTelemetryMetricKey = "cpu" | "memory" | "storage";

export interface WorkloadTelemetryTarget {
  kind: WorkloadTelemetryKind;
  name: string;
  namespace: string;
}

export interface WorkloadTelemetryMetric {
  value: number;
}

export interface WorkloadTelemetryError {
  code: string;
  message: string;
}

export interface WorkloadTelemetrySnapshotItem {
  error?: WorkloadTelemetryError;
  metricErrors?: Partial<
    Record<WorkloadTelemetryMetricKey, WorkloadTelemetryError>
  >;
  metrics?: Partial<
    Record<WorkloadTelemetryMetricKey, WorkloadTelemetryMetric>
  >;
  sampledAt?: string;
  target: WorkloadTelemetryTarget;
}

export interface WorkloadTelemetrySnapshotResponse {
  items: WorkloadTelemetrySnapshotItem[];
}

export interface WorkloadTelemetrySnapshotState {
  item?: WorkloadTelemetrySnapshotItem;
  refreshing: boolean;
}

type WorkloadTelemetryListener = () => void;

export type WorkloadTelemetrySnapshotFetcher = (
  targets: WorkloadTelemetryTarget[]
) => Promise<WorkloadTelemetrySnapshotResponse>;

export interface WorkloadTelemetryStoreOptions {
  autoRefresh?: boolean;
  fetchSnapshot: WorkloadTelemetrySnapshotFetcher;
}

interface ConsumerEntry {
  listeners: Set<WorkloadTelemetryListener>;
  target: WorkloadTelemetryTarget;
}

const EMPTY_SNAPSHOT_STATE: WorkloadTelemetrySnapshotState = {
  refreshing: false,
};

export function workloadTelemetryTargetKey(
  target: WorkloadTelemetryTarget
): string {
  return `${target.kind}:${target.namespace}:${target.name}`;
}

export function createWorkloadTelemetryStore(
  options: WorkloadTelemetryStoreOptions
) {
  const consumers = new Map<string, ConsumerEntry>();
  const cache = new Map<string, WorkloadTelemetrySnapshotItem>();
  const snapshotStates = new Map<string, WorkloadTelemetrySnapshotState>();
  let selectedKey: string | null = null;
  let refreshing = false;
  let refreshScheduled = false;
  let refreshInFlight: Promise<void> | null = null;

  const setSnapshotState = (
    key: string,
    state: WorkloadTelemetrySnapshotState
  ) => {
    const previous = snapshotStates.get(key);
    if (
      previous !== undefined &&
      previous.item === state.item &&
      previous.refreshing === state.refreshing
    ) {
      return false;
    }
    snapshotStates.set(key, state);
    return true;
  };

  const notify = (key: string) => {
    const entry = consumers.get(key);
    if (entry === undefined) {
      return;
    }
    for (const listener of entry.listeners) {
      listener();
    }
  };

  const publishSnapshotState = (
    key: string,
    state: WorkloadTelemetrySnapshotState
  ) => {
    if (setSnapshotState(key, state)) {
      notify(key);
    }
  };

  const publishCachedStates = (targets: WorkloadTelemetryTarget[]) => {
    for (const target of targets) {
      const key = workloadTelemetryTargetKey(target);
      publishSnapshotState(key, { item: cache.get(key), refreshing });
    }
  };

  const activeTargets = () => {
    const targets = Array.from(consumers.values()).map((entry) => entry.target);
    if (selectedKey === null) {
      return targets;
    }
    return targets.sort((a, b) => {
      const aSelected = workloadTelemetryTargetKey(a) === selectedKey;
      const bSelected = workloadTelemetryTargetKey(b) === selectedKey;
      if (aSelected === bSelected) {
        return 0;
      }
      return aSelected ? -1 : 1;
    });
  };

  const runRefresh = async () => {
    const targets = activeTargets();
    if (targets.length === 0) {
      return;
    }

    refreshing = true;
    publishCachedStates(targets);
    try {
      const response = await options.fetchSnapshot(targets);
      for (const item of response.items) {
        const key = workloadTelemetryTargetKey(item.target);
        cache.set(key, item);
        publishSnapshotState(key, { item, refreshing });
      }
    } finally {
      refreshing = false;
      publishCachedStates(targets);
    }
  };

  const refresh = () => {
    if (refreshInFlight !== null) {
      return refreshInFlight;
    }
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const scheduleRefresh = () => {
    if (!options.autoRefresh || refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      refresh().catch(() => undefined);
    });
  };

  return {
    getSnapshot(
      target: WorkloadTelemetryTarget
    ): WorkloadTelemetrySnapshotState {
      return (
        snapshotStates.get(workloadTelemetryTargetKey(target)) ??
        EMPTY_SNAPSHOT_STATE
      );
    },

    refresh,

    setSelectedTarget(target: WorkloadTelemetryTarget | null) {
      selectedKey = target === null ? null : workloadTelemetryTargetKey(target);
    },

    subscribe(
      target: WorkloadTelemetryTarget,
      listener: WorkloadTelemetryListener
    ) {
      const key = workloadTelemetryTargetKey(target);
      const entry = consumers.get(key);
      if (entry === undefined) {
        consumers.set(key, {
          listeners: new Set([listener]),
          target,
        });
        scheduleRefresh();
      } else {
        entry.listeners.add(listener);
      }

      return () => {
        const current = consumers.get(key);
        if (current === undefined) {
          return;
        }
        current.listeners.delete(listener);
        if (current.listeners.size === 0) {
          consumers.delete(key);
        }
      };
    },
  };
}

export type WorkloadTelemetryStore = ReturnType<
  typeof createWorkloadTelemetryStore
>;
