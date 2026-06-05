import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";

import { isPlatformAddressId } from "@/features/project-canvas/platform-addresses";

export const ENTRYPOINT_FAST_REFRESH_MS = 1000;
export const ENTRYPOINT_STEADY_REFRESH_MS = 5000;
export const WORKLOAD_LIST_FAST_REFRESH_MS = 1000;

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

function normalizeWorkloadPhase(input: unknown) {
  return typeof input === "string"
    ? input
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-")
    : "";
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
  return apItemsFromList(data).some((item) => {
    const status =
      item != null && typeof item === "object" && "status" in item
        ? item.status
        : undefined;
    const phase =
      status != null && typeof status === "object" && "phase" in status
        ? phaseFromStatus(status)
        : undefined;
    return WORKLOAD_TRANSIENT_PHASES.has(normalizeWorkloadPhase(phase));
  });
}

export function hasPublicApEndpoint(data: K8sGetResponse | undefined) {
  return apItemsFromList(data).some((item) => {
    if (item == null || typeof item !== "object") {
      return false;
    }
    const root = item as Record<string, unknown>;
    const status =
      root.status != null && typeof root.status === "object"
        ? (root.status as Record<string, unknown>)
        : undefined;
    if (hasNetworkPublicAddresses(status?.network)) {
      return true;
    }

    const spec =
      root.spec != null && typeof root.spec === "object"
        ? (root.spec as Record<string, unknown>)
        : undefined;
    const input =
      spec?.input != null && typeof spec.input === "object"
        ? (spec.input as Record<string, unknown>)
        : undefined;
    return hasNetworkPublicAddresses(
      input?.network != null && typeof input.network === "object"
        ? input.network
        : undefined
    );
  });
}

export function workloadListRefreshIntervalForCanvas({
  discoveryPollUntil,
  latestData,
  now = Date.now(),
  peerEmpty,
  workloadReconcilePollUntil,
}: {
  discoveryPollUntil: number;
  latestData: K8sGetResponse | undefined;
  now?: number;
  peerEmpty: boolean;
  workloadReconcilePollUntil: number;
}) {
  if (
    workloadReconcilePollUntil > now ||
    hasTransientWorkloadPhase(latestData)
  ) {
    return WORKLOAD_LIST_FAST_REFRESH_MS;
  }

  if (
    discoveryPollUntil > now &&
    apItemsFromList(latestData).length === 0 &&
    peerEmpty
  ) {
    return WORKLOAD_LIST_FAST_REFRESH_MS;
  }

  return 0;
}

export function entryPointRefreshIntervalForLifecycle({
  apsData,
  entryPointsData,
  now = Date.now(),
  workloadReconcilePollUntil,
}: {
  apsData: K8sGetResponse | undefined;
  entryPointsData: K8sGetResponse | undefined;
  now?: number;
  workloadReconcilePollUntil: number;
}) {
  if (
    workloadReconcilePollUntil > now ||
    hasTransientWorkloadPhase(apsData) ||
    (hasPublicApEndpoint(apsData) &&
      apItemsFromList(entryPointsData).length === 0)
  ) {
    return ENTRYPOINT_FAST_REFRESH_MS;
  }

  if (
    hasPublicApEndpoint(apsData) &&
    apItemsFromList(entryPointsData).length > 0
  ) {
    return ENTRYPOINT_STEADY_REFRESH_MS;
  }

  return 0;
}

function phaseFromStatus(status: object) {
  return (status as { phase?: unknown }).phase;
}
