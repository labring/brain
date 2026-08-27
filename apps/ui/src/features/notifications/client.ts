import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

import {
  type GiftObservationRequest,
  type NotificationFeedResponse,
  notificationFeedResponseSchema,
  type SubscriptionChangeObservationRequest,
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

async function postObservation(
  pathname: string,
  credentials: NotificationClientCredentials,
  body: unknown,
  label: string,
  fetchImpl: typeof fetch
): Promise<void> {
  const response = await fetchImpl(
    notificationsUrl(pathname, credentials.namespace),
    {
      body: JSON.stringify(body),
      headers: {
        ...personalResourceAuthHeaders(credentials),
        "content-type": "application/json",
      },
      method: "POST",
    }
  );
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status})`);
  }
}

/**
 * Reports a workspace quota snapshot so the quota-exhausted producer can
 * observe it. Best-effort: the sidebar's quota read must never fail on it.
 */
export function reportWorkspaceQuotaObservation(
  credentials: NotificationClientCredentials,
  snapshot: WorkspaceResourceQuotaSnapshot,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<void> {
  return postObservation(
    "/quota-observation",
    credentials,
    { quota: snapshot },
    "Quota observation",
    fetchImpl
  );
}

/** Reports visible gift credit so the gift-hint producer can observe it. */
export function reportGiftCreditObservation(
  credentials: NotificationClientCredentials,
  observation: GiftObservationRequest,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<void> {
  return postObservation(
    "/gift-observation",
    credentials,
    observation,
    "Gift observation",
    fetchImpl
  );
}

/** Reports a settled subscription change so its receipt can be written. */
export function reportSubscriptionChangeObservation(
  credentials: NotificationClientCredentials,
  observation: SubscriptionChangeObservationRequest,
  fetchImpl: typeof fetch = globalThis.fetch
): Promise<void> {
  return postObservation(
    "/subscription-change",
    credentials,
    observation,
    "Subscription-change observation",
    fetchImpl
  );
}
