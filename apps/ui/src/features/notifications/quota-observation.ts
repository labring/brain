import { mutate } from "swr";

import { loadWorkspaceQuotaSnapshot } from "@/features/billing/workspace-quota-client";
import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";
import { hasWorkspaceCredentials } from "@/lib/personal-resource-headers";

import {
  type NotificationClientCredentials,
  reportWorkspaceQuotaObservation,
} from "./client";

/** The SWR key prefix of every mounted Notification Center feed. */
const NOTIFICATION_FEED_KEY_PREFIX = "notifications-feed";

export interface WorkspaceQuotaObservationDependencies {
  loadSnapshot: (
    credentials: NotificationClientCredentials
  ) => Promise<WorkspaceResourceQuotaSnapshot | undefined>;
  refreshFeed: () => Promise<unknown>;
  report: (
    credentials: NotificationClientCredentials,
    snapshot: WorkspaceResourceQuotaSnapshot
  ) => Promise<void>;
}

/** Revalidates every mounted inbox so a produced or released A1 shows now, not next poll. */
function refreshNotificationFeeds(): Promise<unknown> {
  return mutate(
    (key) => Array.isArray(key) && key[0] === NOTIFICATION_FEED_KEY_PREFIX
  );
}

const DEFAULT_DEPENDENCIES: WorkspaceQuotaObservationDependencies = {
  loadSnapshot: loadWorkspaceQuotaSnapshot,
  refreshFeed: refreshNotificationFeeds,
  report: reportWorkspaceQuotaObservation,
};

/**
 * The client-side observation point of the quota-exhausted producer (A1):
 * reads the workspace's quota snapshot and hands it to the producer, then
 * refreshes the inbox so the entry (or its release) lands with the banner
 * that shows the same state. Every quota surface that polls — the App
 * Sidebar on mount, the Status Hint on its cadence — reports through here,
 * so the banner and the inbox observe the same snapshot at the same time
 * and the producer's edge-triggering sees every crossing and recovery.
 * Best-effort: a failed read or report resolves false and never throws; the
 * producer dedupes by naming, so the next poll simply observes again.
 */
export async function observeWorkspaceQuotaForInbox(
  credentials: NotificationClientCredentials,
  dependencies: WorkspaceQuotaObservationDependencies = DEFAULT_DEPENDENCIES
): Promise<boolean> {
  const namespace = credentials.namespace.trim();
  const normalizedCredentials = { ...credentials, namespace };
  if (!hasWorkspaceCredentials(normalizedCredentials)) {
    return false;
  }
  try {
    const snapshot = await dependencies.loadSnapshot(normalizedCredentials);
    if (snapshot == null) {
      return false;
    }
    return reportWorkspaceQuotaSnapshotForInbox(
      normalizedCredentials,
      snapshot,
      dependencies
    );
  } catch {
    return false;
  }
}

/** Reports a snapshot another quota surface already derived from its read. */
export function observeWorkspaceQuotaSnapshotForInbox(
  credentials: NotificationClientCredentials,
  snapshot: WorkspaceResourceQuotaSnapshot,
  dependencies: WorkspaceQuotaObservationDependencies = DEFAULT_DEPENDENCIES
): Promise<boolean> {
  const namespace = credentials.namespace.trim();
  const normalizedCredentials = { ...credentials, namespace };
  if (!hasWorkspaceCredentials(normalizedCredentials)) {
    return Promise.resolve(false);
  }
  return reportWorkspaceQuotaSnapshotForInbox(
    normalizedCredentials,
    snapshot,
    dependencies
  );
}

async function reportWorkspaceQuotaSnapshotForInbox(
  credentials: NotificationClientCredentials,
  snapshot: WorkspaceResourceQuotaSnapshot,
  dependencies: WorkspaceQuotaObservationDependencies
): Promise<boolean> {
  try {
    await dependencies.report(credentials, snapshot);
  } catch {
    return false;
  }
  await dependencies.refreshFeed().catch(() => undefined);
  return true;
}
