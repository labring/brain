import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

import {
  type NotificationFeedResponse,
  notificationFeedResponseSchema,
} from "./types";

/** Credentials every Brain-side notification request carries (ADR-0059). */
export interface NotificationClientCredentials {
  appToken: string;
  kubeconfig: string;
  namespace: string;
}

function notificationsUrl(pathname: string, namespace: string): string {
  const search = new URLSearchParams({ namespace });
  return `/api/notifications${pathname}?${search.toString()}`;
}

/** The `db:` stream and the user's receipts for the current workspace. */
export async function fetchNotificationFeed(
  credentials: NotificationClientCredentials,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<NotificationFeedResponse> {
  const response = await fetchImpl(
    notificationsUrl("", credentials.namespace),
    { headers: personalResourceAuthHeaders(credentials) }
  );
  if (!response.ok) {
    throw new Error(`Notification feed request failed (${response.status})`);
  }
  return notificationFeedResponseSchema.parse(await response.json());
}

/** Records per-user receipts for the given source-prefixed ids. */
export async function postNotificationReadReceipts(
  credentials: NotificationClientCredentials,
  ids: readonly string[],
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const response = await fetchImpl(
    notificationsUrl("/read", credentials.namespace),
    {
      body: JSON.stringify({ ids }),
      headers: {
        ...personalResourceAuthHeaders(credentials),
        "content-type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(`Mark-read request failed (${response.status})`);
  }
}

/**
 * Reports a workspace quota snapshot so the quota-exhausted producer can
 * observe it. Best-effort: the sidebar's quota read must never fail on it.
 */
export async function reportWorkspaceQuotaObservation(
  credentials: NotificationClientCredentials,
  snapshot: WorkspaceResourceQuotaSnapshot,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<void> {
  const response = await fetchImpl(
    notificationsUrl("/quota-observation", credentials.namespace),
    {
      body: JSON.stringify({ quota: snapshot }),
      headers: {
        ...personalResourceAuthHeaders(credentials),
        "content-type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(`Quota observation request failed (${response.status})`);
  }
}
