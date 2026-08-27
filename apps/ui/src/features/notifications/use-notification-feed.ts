"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import {
  markNotificationCRRead,
  NOTIFICATION_CR_REFRESH_INTERVAL_MS,
  useNotificationCRList,
} from "@workspace/api/hooks";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import useSWR from "swr";

import {
  type AppNotification,
  countUnreadNotifications,
  isNotificationUnread,
} from "@/features/shell/app-sidebar-notifications-model";
import {
  notificationReadIdsAtom,
  notificationsDevMockItemsAtom,
} from "@/features/shell/app-sidebar-notifications-store";
import { useWorkspaceSubscriptionSummary } from "@/features/shell/use-workspace-subscription-summary";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import { fetchNotificationFeed, postNotificationReadReceipts } from "./client";
import { mergeNotificationFeed } from "./feed-model";
import { planReadDispatch } from "./read-dispatch";

const EMPTY_ITEMS: readonly AppNotification[] = [];

export interface NotificationFeed {
  items: readonly AppNotification[];
  markAllRead: () => void;
  markRead: (item: AppNotification) => void;
  readIds: ReadonlySet<string>;
  unreadCount: number;
}

/**
 * The merged Notification Center feed: platform CRs polled from the cluster
 * (≤5 minutes) and Brain-produced entries plus the user's receipts from
 * Brain's store, merged client-side into one list. Mark-read is optimistic
 * and dispatched per source; a Dev Mock override replaces the items outright.
 */
export function useNotificationFeed(): NotificationFeed {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom).trim();
  const mockItems = useAtomValue(notificationsDevMockItemsAtom);
  const [readIds, setReadIds] = useAtom(notificationReadIdsAtom);
  const { data: subscription } = useWorkspaceSubscriptionSummary();

  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && namespace !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);

  const crList = useNotificationCRList({
    enabled: mockItems == null,
    kubeconfig,
    namespace,
  });
  const brainFeed = useSWR(
    credentialsReady && mockItems == null
      ? (["notifications-feed", namespace, credentialKey, appToken] as const)
      : null,
    () => fetchNotificationFeed({ appToken, kubeconfig, namespace }),
    {
      refreshInterval: NOTIFICATION_CR_REFRESH_INTERVAL_MS,
      shouldRetryOnError: false,
    }
  );

  const items = useMemo(() => {
    if (mockItems != null) {
      return mockItems;
    }
    if (crList.data == null && brainFeed.data == null) {
      return EMPTY_ITEMS;
    }
    return mergeNotificationFeed({
      crItems: crList.data?.items ?? [],
      dbMessages: brainFeed.data?.messages ?? [],
      receipts: brainFeed.data?.receipts ?? [],
    });
  }, [brainFeed.data, crList.data, mockItems]);

  const dispatchRead = useCallback(
    (targets: readonly AppNotification[]) => {
      if (targets.length === 0) {
        return;
      }
      setReadIds((previous) => {
        const next = new Set(previous);
        for (const target of targets) {
          next.add(target.id);
        }
        return next;
      });
      if (mockItems != null || !credentialsReady) {
        return;
      }
      const plan = planReadDispatch(targets, subscription?.role);
      const credentials = { appToken, kubeconfig, namespace };
      postNotificationReadReceipts(credentials, plan.receiptIds)
        .then(() => brainFeed.mutate())
        .catch(() => undefined);
      // Desktop parity is best-effort: a 403 (Developer RBAC) or any other
      // failure is swallowed — the receipt already made the message read.
      for (const name of plan.crNames) {
        markNotificationCRRead({ kubeconfig, name, namespace })
          .then(() => crList.mutate())
          .catch(() => undefined);
      }
    },
    [
      appToken,
      brainFeed.mutate,
      credentialsReady,
      crList.mutate,
      kubeconfig,
      mockItems,
      namespace,
      setReadIds,
      subscription?.role,
    ]
  );

  const markRead = useCallback(
    (item: AppNotification) => dispatchRead([item]),
    [dispatchRead]
  );
  const markAllRead = useCallback(
    () =>
      dispatchRead(items.filter((item) => isNotificationUnread(item, readIds))),
    [dispatchRead, items, readIds]
  );

  return {
    items,
    markAllRead,
    markRead,
    readIds,
    unreadCount: countUnreadNotifications(items, readIds),
  };
}
