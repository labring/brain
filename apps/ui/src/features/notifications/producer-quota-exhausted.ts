import type {
  WorkspaceQuotaItem,
  WorkspaceResourceQuotaSnapshot,
} from "@/features/billing/workspace-resource-quota";

import type { NotificationStore } from "./store";
import type { QuotaExhaustedResource } from "./types";

/**
 * The first Brain-side producer (catalog row A1): when any workspace resource
 * quota reaches 100% during a user's request, exactly one "quota is full"
 * entry appears per resource. Edge-triggered by naming — the dedupe key is
 * live while the resource stays full, so retries and repeated observations
 * write nothing; falling below 100% releases the key so the next crossing
 * writes a fresh entry. No scheduler, no periodic re-sends.
 */

export const QUOTA_EXHAUSTED_DEDUPE_PREFIX = "quota-exhausted";

export function quotaExhaustedDedupeKey(
  namespace: string,
  resource: QuotaExhaustedResource
): string {
  return `${QUOTA_EXHAUSTED_DEDUPE_PREFIX}:${namespace}:${resource}`;
}

/** 100% of the limit; a zero or unknown limit never counts as exhausted. */
export function isQuotaExhausted(item: WorkspaceQuotaItem): boolean {
  return (
    Number.isFinite(item.limit) &&
    Number.isFinite(item.used) &&
    item.limit > 0 &&
    item.used >= item.limit
  );
}

export interface QuotaObservationResult {
  produced: QuotaExhaustedResource[];
  released: QuotaExhaustedResource[];
}

export type QuotaObservationStore = Pick<
  NotificationStore,
  "produce" | "release"
>;

/**
 * Observes one quota snapshot for a workspace: exhausted resources produce
 * (deduped), recovered resources release. Resources absent from the snapshot
 * are unknown and left alone.
 */
export async function observeWorkspaceQuotaForNotifications(
  store: QuotaObservationStore,
  input: {
    namespace: string;
    now?: Date;
    snapshot: WorkspaceResourceQuotaSnapshot;
  }
): Promise<QuotaObservationResult> {
  const result: QuotaObservationResult = { produced: [], released: [] };
  const namespace = input.namespace.trim();
  if (namespace === "") {
    return result;
  }
  for (const item of input.snapshot.items) {
    const dedupeKey = quotaExhaustedDedupeKey(namespace, item.type);
    if (isQuotaExhausted(item)) {
      const produced = await store.produce({
        dedupeKey,
        kind: "quota-exhausted",
        namespace,
        now: input.now,
        payload: {
          kind: "quota-exhausted",
          limit: item.limit,
          resource: item.type,
          used: item.used,
        },
      });
      if (produced) {
        result.produced.push(item.type);
      }
    } else if (await store.release({ dedupeKey, now: input.now })) {
      result.released.push(item.type);
    }
  }
  return result;
}
