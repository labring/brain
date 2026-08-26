"use client";

import { sealosApp } from "@labring/sealos-desktop-sdk/app";
import {
  parseWorkspaceQuotaItems,
  type WorkspaceResourceQuotaSnapshot,
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

function cacheKey(namespace: string): string {
  return namespace.trim();
}

async function fetchWorkspaceQuotaSnapshot(
  namespace: string
): Promise<WorkspaceResourceQuotaSnapshot | undefined> {
  try {
    const snapshot = await sealosApp.getWorkspaceQuota();
    const items = parseWorkspaceQuotaItems(snapshot?.quota);
    const result = items.length === 0 ? undefined : { items };
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
  namespace: string
): WorkspaceResourceQuotaSnapshot | undefined {
  const key = cacheKey(namespace);
  const cached = workspaceQuotaCache.get(key);
  if (
    cached != null &&
    Date.now() - cached.fetchedAt >= WORKSPACE_QUOTA_CACHE_TTL_MS
  ) {
    loadWorkspaceQuotaSnapshot(key).catch(() => undefined);
  }
  return cached?.snapshot;
}

export function loadWorkspaceQuotaSnapshot(
  namespace: string
): Promise<WorkspaceResourceQuotaSnapshot | undefined> {
  const key = cacheKey(namespace);
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

  const request = fetchWorkspaceQuotaSnapshot(key).finally(() => {
    workspaceQuotaRequests.delete(key);
  });
  workspaceQuotaRequests.set(key, request);
  return request;
}
