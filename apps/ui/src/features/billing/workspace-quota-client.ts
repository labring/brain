"use client";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  type WorkspaceResourceQuotaSnapshot,
  workspaceQuotaSnapshotFromPayload,
} from "./workspace-resource-quota";

const WORKSPACE_QUOTA_CACHE_TTL_MS = 30_000;

interface WorkspaceQuotaCacheEntry {
  fetchedAt: number;
  snapshot: WorkspaceResourceQuotaSnapshot | undefined;
}

const workspaceQuotaCache = new Map<string, WorkspaceQuotaCacheEntry>();
const workspaceQuotaRequests = new Map<
  string,
  Promise<WorkspaceResourceQuotaSnapshot | undefined>
>();

export interface WorkspaceQuotaLoadInput extends BillingCredentials {
  namespace: string;
}

function cacheKey(input: WorkspaceQuotaLoadInput): string {
  return input.namespace.trim();
}

async function fetchWorkspaceQuotaSnapshot(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch
): Promise<WorkspaceResourceQuotaSnapshot | undefined> {
  const namespace = cacheKey(input);
  try {
    const requestBillingJson = createBillingJsonRequester({
      credentials: input,
      fallbackErrorMessage: "Could not load workspace quota.",
      fetch,
    });
    const payload = await requestBillingJson("/api/billing/workspace-quota", {
      workspace: namespace,
    });
    const result = workspaceQuotaSnapshotFromPayload(payload);
    workspaceQuotaCache.set(namespace, {
      fetchedAt: Date.now(),
      snapshot: result,
    });
    return result;
  } catch {
    const previous = workspaceQuotaCache.get(namespace);
    workspaceQuotaCache.set(namespace, {
      fetchedAt: Date.now(),
      snapshot: previous?.snapshot,
    });
    return previous?.snapshot;
  }
}

export function readCachedWorkspaceQuotaSnapshot(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch = globalThis.fetch
): WorkspaceResourceQuotaSnapshot | undefined {
  const key = cacheKey(input);
  const cached = workspaceQuotaCache.get(key);
  if (
    cached != null &&
    Date.now() - cached.fetchedAt >= WORKSPACE_QUOTA_CACHE_TTL_MS
  ) {
    loadWorkspaceQuotaSnapshot(input, fetch).catch(() => undefined);
  }
  return cached?.snapshot;
}

export function loadWorkspaceQuotaSnapshot(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<WorkspaceResourceQuotaSnapshot | undefined> {
  const key = cacheKey(input);
  if (
    key === "" ||
    input.appToken.trim() === "" ||
    input.kubeconfig.trim() === ""
  ) {
    return Promise.resolve(undefined);
  }
  const cached = workspaceQuotaCache.get(key);
  if (
    cached != null &&
    Date.now() - cached.fetchedAt < WORKSPACE_QUOTA_CACHE_TTL_MS
  ) {
    return Promise.resolve(cached.snapshot);
  }

  const pending = workspaceQuotaRequests.get(key);
  if (pending != null) {
    return pending;
  }

  const request = fetchWorkspaceQuotaSnapshot(
    { ...input, namespace: key },
    fetch
  ).finally(() => {
    workspaceQuotaRequests.delete(key);
  });
  workspaceQuotaRequests.set(key, request);
  return request;
}
