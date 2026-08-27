"use client";

import useSWR from "swr";
import { API_ROUTES } from "../constants";
import {
  kubeconfigBearerHeader,
  kubeconfigCredentialKey,
} from "../credential-key";
import { type FetcherOptions, fetcher } from "../fetch";
import { ApiUrl } from "../utils";

/**
 * One upstream Notification CR as the Go read proxy flattens it. The
 * platform owns these messages (fixed names, overwritten in place, revived
 * as unread on escalation, auto-read on recovery); Brain reads them live with
 * the caller's own kubeconfig and never copies them.
 */
export interface NotificationCRItem {
  creationTimestamp?: string;
  desktopPopup: boolean;
  from?: string;
  importance?: string;
  /** `metadata.labels.isRead === "true"` — the desktop's read state. */
  isRead: boolean;
  message: string;
  name: string;
  namespace: string;
  /** `spec.timestamp` in Unix seconds. */
  timestamp: number;
  title: string;
  uid?: string;
}

export interface NotificationCRListResponse {
  items: NotificationCRItem[];
  namespace: string;
}

export interface NotificationCRReadResponse {
  isRead: boolean;
  name: string;
  namespace: string;
}

export type NotificationCRFetchRequest = Omit<FetcherOptions, "base">;

/** The desktop polls its own inbox every 5 minutes; match it. */
export const NOTIFICATION_CR_REFRESH_INTERVAL_MS = 5 * 60_000;

export function notificationCRReadPath(name: string): string {
  return `${API_ROUTES.notification.root}/${encodeURIComponent(name)}/read`;
}

export function buildNotificationCRListRequest(options: {
  kubeconfig: string;
  namespace: string;
}): NotificationCRFetchRequest {
  return {
    header: {
      Authorization: kubeconfigBearerHeader(options.kubeconfig),
    },
    method: "GET",
    path: API_ROUTES.notification.root,
    query: { namespace: options.namespace },
  };
}

export function buildNotificationCRReadRequest(options: {
  kubeconfig: string;
  name: string;
  namespace: string;
}): NotificationCRFetchRequest {
  return {
    header: {
      Authorization: kubeconfigBearerHeader(options.kubeconfig),
    },
    method: "PATCH",
    path: notificationCRReadPath(options.name),
    query: { namespace: options.namespace },
  };
}

/** Merge-patches the CR's `isRead` label — the desktop-compatible read write. */
export function markNotificationCRRead(options: {
  kubeconfig: string;
  name: string;
  namespace: string;
}): Promise<NotificationCRReadResponse> {
  return fetcher<NotificationCRReadResponse>({
    base: ApiUrl(),
    ...buildNotificationCRReadRequest(options),
  });
}

export function useNotificationCRList(options: {
  enabled?: boolean;
  kubeconfig?: string;
  namespace: string;
  /** @default NOTIFICATION_CR_REFRESH_INTERVAL_MS */
  refreshInterval?: number;
}) {
  const {
    enabled = true,
    refreshInterval = NOTIFICATION_CR_REFRESH_INTERVAL_MS,
  } = options;
  const kubeconfig = options.kubeconfig ?? "";
  const namespace = options.namespace.trim();
  const credentialKey = kubeconfigCredentialKey(kubeconfig);
  const shouldFetch = enabled && kubeconfig.trim() !== "" && namespace !== "";
  const swrKey = shouldFetch
    ? ([API_ROUTES.notification.root, namespace, credentialKey] as const)
    : null;

  return useSWR(
    swrKey,
    () =>
      fetcher<NotificationCRListResponse>({
        base: ApiUrl(),
        ...buildNotificationCRListRequest({ kubeconfig, namespace }),
      }),
    { refreshInterval, revalidateOnFocus: true }
  );
}
