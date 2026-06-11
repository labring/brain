import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";

import { isPlatformAddressId } from "@/features/project-canvas/platform-addresses";

export const ENTRYPOINT_FAST_REFRESH_MS = 1000;
export const WORKLOAD_LIST_FAST_REFRESH_MS = 1000;
export const WORKLOAD_LIST_MEDIUM_REFRESH_MS = 5000;
export const WORKLOAD_LIST_STUCK_REFRESH_MS = 10_000;
export const WORKLOAD_LIST_BACKGROUND_REFRESH_MS = 30_000;
export const WORKLOAD_TRANSIENT_FAST_WINDOW_MS = 60_000;
export const WORKLOAD_TRANSIENT_MEDIUM_WINDOW_MS = 5 * 60_000;

const WORKLOAD_TRANSIENT_PHASES = new Set([
  "binding",
  "creating",
  "deleting",
  "pending",
  "progressing",
  "reconciling",
  "restarting",
  "starting",
  "stopping",
  "updating",
]);

export type WorkloadTransientSinceByKey = Map<string, number>;

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input != null && typeof input === "object"
    ? (input as Record<string, unknown>)
    : undefined;
}

function normalizeWorkloadPhase(input: unknown) {
  return typeof input === "string"
    ? input
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
    : "";
}

function numberField(input: unknown) {
  return typeof input === "number" && Number.isFinite(input)
    ? input
    : undefined;
}

function workloadPhaseFromItem(item: unknown) {
  const root = asRecord(item);
  const status = asRecord(root?.status);
  const explicitPhase = status?.phase;
  if (typeof explicitPhase === "string") {
    return explicitPhase;
  }

  const replicas = numberField(status?.replicas);
  if (replicas == null || replicas <= 0) {
    return undefined;
  }
  const readyReplicas = numberField(status?.readyReplicas) ?? 0;
  return readyReplicas >= replicas ? "running" : "creating";
}

function isTransientWorkloadItem(item: unknown) {
  return WORKLOAD_TRANSIENT_PHASES.has(
    normalizeWorkloadPhase(workloadPhaseFromItem(item))
  );
}

function metadataRecord(item: unknown) {
  return asRecord(asRecord(item)?.metadata);
}

function stringField(input: unknown) {
  return typeof input === "string" && input !== "" ? input : undefined;
}

function workloadResourceKey({
  fallbackNamespace,
  item,
  resourceKind,
}: {
  fallbackNamespace?: string | undefined;
  item: unknown;
  resourceKind: string;
}) {
  const metadata = metadataRecord(item);
  const namespace = stringField(metadata?.namespace) ?? fallbackNamespace ?? "";
  const name = stringField(metadata?.name);
  const uid = stringField(metadata?.uid);
  if (name == null && uid == null) {
    return undefined;
  }
  return [resourceKind, namespace, name ?? "", uid ?? ""].join("/");
}

function minPositiveInterval(a: number, b: number) {
  if (a > 0 && b > 0) {
    return Math.min(a, b);
  }
  return a > 0 ? a : b;
}

export function workloadTransientRefreshIntervalForAge(ageMs: number) {
  if (ageMs <= WORKLOAD_TRANSIENT_FAST_WINDOW_MS) {
    return WORKLOAD_LIST_FAST_REFRESH_MS;
  }
  if (ageMs <= WORKLOAD_TRANSIENT_MEDIUM_WINDOW_MS) {
    return WORKLOAD_LIST_MEDIUM_REFRESH_MS;
  }
  return WORKLOAD_LIST_STUCK_REFRESH_MS;
}

function applyPageVisibilityRefreshInterval({
  interval,
  isPageVisible,
}: {
  interval: number;
  isPageVisible: boolean;
}) {
  if (isPageVisible || interval <= 0) {
    return interval;
  }
  return Math.max(interval, WORKLOAD_LIST_BACKGROUND_REFRESH_MS);
}

export function trackedWorkloadRefreshInterval({
  fallbackNamespace,
  latestData,
  now,
  predicate,
  resourceKind,
  transientSinceByKey,
}: {
  fallbackNamespace?: string | undefined;
  latestData: K8sGetResponse | undefined;
  now: number;
  predicate?: ((item: unknown) => boolean) | undefined;
  resourceKind: string;
  transientSinceByKey: WorkloadTransientSinceByKey;
}) {
  const activeKeys = new Set<string>();
  let interval = 0;
  for (const item of apItemsFromList(latestData)) {
    const key = workloadResourceKey({ fallbackNamespace, item, resourceKind });
    if (key == null) {
      continue;
    }
    activeKeys.add(key);
    if (predicate == null ? isTransientWorkloadItem(item) : predicate(item)) {
      const since = transientSinceByKey.get(key) ?? now;
      transientSinceByKey.set(key, since);
      interval = minPositiveInterval(
        interval,
        workloadTransientRefreshIntervalForAge(now - since)
      );
    } else {
      transientSinceByKey.delete(key);
    }
  }

  for (const key of transientSinceByKey.keys()) {
    if (!activeKeys.has(key)) {
      transientSinceByKey.delete(key);
    }
  }

  return interval;
}

function hasPlatformAddressRequest(item: unknown) {
  if (item == null || typeof item !== "object") {
    return false;
  }
  return isPlatformAddressId((item as Record<string, unknown>).id);
}

function hasNetworkPublicAddresses(network: unknown) {
  if (network == null || typeof network !== "object") {
    return false;
  }
  const publicAddresses = (network as Record<string, unknown>).publicAddresses;
  if (Array.isArray(publicAddresses) && publicAddresses.length > 0) {
    return true;
  }
  const platformAddresses = (network as Record<string, unknown>)
    .platformAddresses;
  return (
    Array.isArray(platformAddresses) &&
    platformAddresses.some(hasPlatformAddressRequest)
  );
}

export function hasTransientWorkloadPhase(data: K8sGetResponse | undefined) {
  return apItemsFromList(data).some(isTransientWorkloadItem);
}

export function hasPublicApEndpoint(data: K8sGetResponse | undefined) {
  return apItemsFromList(data).some(hasPublicApEndpointItem);
}

function hasPublicApEndpointItem(item: unknown) {
  const root = asRecord(item);
  if (root == null) {
    return false;
  }
  const status = asRecord(root.status);
  if (hasNetworkPublicAddresses(status?.network)) {
    return true;
  }

  const spec = asRecord(root.spec);
  const input = asRecord(spec?.input);
  return hasNetworkPublicAddresses(asRecord(input?.network));
}

export function workloadListRefreshIntervalForCanvas({
  discoveryPollUntil,
  fallbackNamespace,
  isPageVisible = true,
  latestData,
  now = Date.now(),
  peerEmpty,
  resourceKind = "workload",
  transientSinceByKey = new Map<string, number>(),
  workloadReconcilePollUntil,
}: {
  discoveryPollUntil: number;
  fallbackNamespace?: string | undefined;
  isPageVisible?: boolean;
  latestData: K8sGetResponse | undefined;
  now?: number;
  peerEmpty: boolean;
  resourceKind?: string;
  transientSinceByKey?: WorkloadTransientSinceByKey;
  workloadReconcilePollUntil: number;
}) {
  let interval = 0;
  if (workloadReconcilePollUntil > now) {
    interval = WORKLOAD_LIST_FAST_REFRESH_MS;
  }

  interval = minPositiveInterval(
    interval,
    trackedWorkloadRefreshInterval({
      fallbackNamespace,
      latestData,
      now,
      resourceKind,
      transientSinceByKey,
    })
  );

  if (
    discoveryPollUntil > now &&
    apItemsFromList(latestData).length === 0 &&
    peerEmpty
  ) {
    interval = minPositiveInterval(interval, WORKLOAD_LIST_FAST_REFRESH_MS);
  }

  return applyPageVisibilityRefreshInterval({ interval, isPageVisible });
}

export function entryPointRefreshIntervalForLifecycle({
  apsData,
  entryPointsData,
  fallbackNamespace,
  isPageVisible = true,
  now = Date.now(),
  publicEndpointSinceByKey = new Map<string, number>(),
  workloadReconcilePollUntil,
}: {
  apsData: K8sGetResponse | undefined;
  entryPointsData: K8sGetResponse | undefined;
  fallbackNamespace?: string | undefined;
  isPageVisible?: boolean;
  now?: number;
  publicEndpointSinceByKey?: WorkloadTransientSinceByKey;
  workloadReconcilePollUntil: number;
}) {
  let interval = 0;
  if (workloadReconcilePollUntil > now) {
    interval = ENTRYPOINT_FAST_REFRESH_MS;
  }

  if (apItemsFromList(entryPointsData).length === 0) {
    interval = minPositiveInterval(
      interval,
      trackedWorkloadRefreshInterval({
        fallbackNamespace,
        latestData: apsData,
        now,
        predicate: hasPublicApEndpointItem,
        resourceKind: "entrypoint-public-routing",
        transientSinceByKey: publicEndpointSinceByKey,
      })
    );
  } else {
    publicEndpointSinceByKey.clear();
  }

  return applyPageVisibilityRefreshInterval({ interval, isPageVisible });
}
