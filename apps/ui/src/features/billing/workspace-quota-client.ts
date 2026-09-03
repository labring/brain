import {
  hasWorkspaceCredentials,
  type WorkspaceCredentials,
} from "@/lib/personal-resource-headers";
import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  type AccountServiceWorkspaceQuotaResponse,
  accountServiceWorkspaceQuotaResponseSchema,
} from "./workspace-quota-payload";
import {
  type WorkspaceResourceQuotaSnapshot,
  workspaceQuotaSnapshotFromResponse,
} from "./workspace-resource-quota";

const WORKSPACE_QUOTA_CACHE_TTL_MS = 30_000;

interface WorkspaceQuotaCacheEntry {
  error?: unknown;
  fetchedAt: number;
  response?: AccountServiceWorkspaceQuotaResponse;
}

const workspaceQuotaCache = new Map<string, WorkspaceQuotaCacheEntry>();
const workspaceQuotaRequests = new Map<
  string,
  Promise<AccountServiceWorkspaceQuotaResponse>
>();

export type WorkspaceQuotaLoadInput = WorkspaceCredentials;

function workspaceQuotaCacheKey(input: WorkspaceQuotaLoadInput): string {
  return JSON.stringify([
    input.namespace.trim(),
    input.appToken,
    input.kubeconfig,
  ]);
}

async function fetchWorkspaceQuotaResponse(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch
): Promise<AccountServiceWorkspaceQuotaResponse> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: input,
    fallbackErrorMessage: "Could not load workspace quota.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/workspace-quota", {
    workspace: input.namespace.trim(),
  });
  return accountServiceWorkspaceQuotaResponseSchema.parse(payload);
}

export function loadWorkspaceQuotaResponse(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<AccountServiceWorkspaceQuotaResponse> {
  if (!hasWorkspaceCredentials(input)) {
    return Promise.reject(new Error("Workspace credentials are incomplete."));
  }
  const key = workspaceQuotaCacheKey(input);
  const cached = workspaceQuotaCache.get(key);
  if (
    cached != null &&
    Date.now() - cached.fetchedAt < WORKSPACE_QUOTA_CACHE_TTL_MS
  ) {
    if (cached.response !== undefined) {
      return Promise.resolve(cached.response);
    }
    return Promise.reject(
      cached.error ?? new Error("Could not load workspace quota.")
    );
  }

  const pending = workspaceQuotaRequests.get(key);
  if (pending != null) {
    return pending;
  }

  const request = fetchWorkspaceQuotaResponse(
    { ...input, namespace: input.namespace.trim() },
    fetch
  )
    .then((response) => {
      workspaceQuotaCache.set(key, { fetchedAt: Date.now(), response });
      return response;
    })
    .catch((error: unknown) => {
      const previous = workspaceQuotaCache.get(key);
      workspaceQuotaCache.set(key, {
        error,
        fetchedAt: Date.now(),
        response: previous?.response,
      });
      if (previous?.response !== undefined) {
        return previous.response;
      }
      throw error;
    })
    .finally(() => {
      workspaceQuotaRequests.delete(key);
    });
  workspaceQuotaRequests.set(key, request);
  return request;
}

export function readCachedWorkspaceQuotaSnapshot(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch = globalThis.fetch
): WorkspaceResourceQuotaSnapshot | undefined {
  if (!hasWorkspaceCredentials(input)) {
    return undefined;
  }
  const key = workspaceQuotaCacheKey(input);
  const cached = workspaceQuotaCache.get(key);
  if (
    cached != null &&
    Date.now() - cached.fetchedAt >= WORKSPACE_QUOTA_CACHE_TTL_MS
  ) {
    loadWorkspaceQuotaResponse(input, fetch).catch(() => undefined);
  }
  return cached?.response === undefined
    ? undefined
    : workspaceQuotaSnapshotFromResponse(cached.response);
}

export function loadWorkspaceQuotaSnapshot(
  input: WorkspaceQuotaLoadInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<WorkspaceResourceQuotaSnapshot | undefined> {
  if (!hasWorkspaceCredentials(input)) {
    return Promise.resolve(undefined);
  }
  return loadWorkspaceQuotaResponse(input, fetch)
    .then(workspaceQuotaSnapshotFromResponse)
    .catch(() => undefined);
}
