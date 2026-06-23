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

const EMPTY_SNAPSHOT_STATE: WorkloadTelemetrySnapshotState = {};

function targetsEqual(
  a: WorkloadTelemetryTarget,
  b: WorkloadTelemetryTarget
): boolean {
  return a.kind === b.kind && a.name === b.name && a.namespace === b.namespace;
}

function errorsEqual(
  a: WorkloadTelemetryError | undefined,
  b: WorkloadTelemetryError | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.code === b.code && a.message === b.message;
}

function metricEqual(
  a: WorkloadTelemetryMetric | undefined,
  b: WorkloadTelemetryMetric | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.value === b.value;
}

function recordKeys(value: object | undefined): string[] {
  return value === undefined ? [] : Object.keys(value);
}

function recordsEqual<T>(
  a: Partial<Record<WorkloadTelemetryMetricKey, T>> | undefined,
  b: Partial<Record<WorkloadTelemetryMetricKey, T>> | undefined,
  equal: (left: T | undefined, right: T | undefined) => boolean
): boolean {
  const keys = new Set([...recordKeys(a), ...recordKeys(b)]);
  for (const key of keys) {
    const metricKey = key as WorkloadTelemetryMetricKey;
    if (!equal(a?.[metricKey], b?.[metricKey])) {
      return false;
    }
  }
  return true;
}

function snapshotItemsEqual(
  a: WorkloadTelemetrySnapshotItem,
  b: WorkloadTelemetrySnapshotItem
): boolean {
  // Canvas nodes render values/errors; sampledAt churn alone should not repaint every active node.
  return (
    targetsEqual(a.target, b.target) &&
    errorsEqual(a.error, b.error) &&
    recordsEqual(a.metricErrors, b.metricErrors, errorsEqual) &&
    recordsEqual(a.metrics, b.metrics, metricEqual)
  );
}

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
  let refreshScheduled = false;
  let refreshInFlight: Promise<void> | null = null;

  const snapshotStateForKey = (
    key: string
  ): WorkloadTelemetrySnapshotState => ({
    item: cache.get(key),
  });

  const setSnapshotState = (
    key: string,
    state: WorkloadTelemetrySnapshotState
  ) => {
    const previous = snapshotStates.get(key);
    if (previous !== undefined && previous.item === state.item) {
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

  const activeTargets = () => {
    return Array.from(consumers.values()).map((entry) => entry.target);
  };

  const runRefresh = async () => {
    const targets = activeTargets();
    if (targets.length === 0) {
      return;
    }

    const response = await options.fetchSnapshot(targets);
    for (const item of response.items) {
      const key = workloadTelemetryTargetKey(item.target);
      const previous = cache.get(key);
      cache.set(
        key,
        previous !== undefined && snapshotItemsEqual(previous, item)
          ? previous
          : item
      );
      publishSnapshotState(key, snapshotStateForKey(key));
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

    hasActiveTargets() {
      return consumers.size > 0;
    },

    refresh,

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
