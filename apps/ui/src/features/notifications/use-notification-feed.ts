"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import {
  markNotificationCRRead,
  NOTIFICATION_CR_REFRESH_INTERVAL_MS,
  useNotificationCRList,
} from "@workspace/api/hooks";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { loadAccountCredits } from "@/features/billing/account-credits";
import { loadHasToppedUp } from "@/features/billing/account-top-up";
import {
  type AppNotification,
  countUnreadNotifications,
  isNotificationUnread,
} from "@/features/shell/app-sidebar-notifications-model";
import { notificationReadIdsAtom } from "@/features/shell/app-sidebar-notifications-store";
import { useWorkspaceSubscriptionSummary } from "@/features/shell/use-workspace-subscription-summary";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import {
  fetchNotificationFeed,
  postNotificationReadReceipts,
  reportGiftCreditObservation,
} from "./client";
import { isGiftOnlyNewcomer, mergeNotificationFeed } from "./feed-model";
import { planReadDispatch } from "./read-dispatch";

const EMPTY_ITEMS: readonly AppNotification[] = [];

export interface NotificationFeed {
  items: readonly AppNotification[];
  markAllRead: () => void;
  /**
   * One dispatch for several items — the Billing Escalation Dialog's
   * dismissal reads the announced stage and the ones it superseded together.
   */
  markManyRead: (items: readonly AppNotification[]) => void;
  markRead: (item: AppNotification) => void;
  readIds: ReadonlySet<string>;
  unreadCount: number;
}

/**
 * The merged Notification Center feed: platform CRs polled from the cluster
 * (≤5 minutes) and Brain-produced entries plus the user's receipts from
 * Brain's store, merged client-side into one list with the display layer
 * applied (override table, gift-only filter). Mark-read is optimistic and
 * dispatched per source; a failed receipt rolls the optimistic state back so
 * the item reads unread again and the click can be retried. The account's
 * credits and top-up history decide the gift-only filter and are the gift
 * hint's observation point; while the billing Dev Mock serves the feed, its
 * fixture CRs replace the cluster poll.
 */
export function useNotificationFeed(): NotificationFeed {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom).trim();
  const [readIds, setReadIds] = useAtom(notificationReadIdsAtom);
  const { data: subscription } = useWorkspaceSubscriptionSummary();

  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && namespace !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);

  const brainFeed = useSWR(
    credentialsReady
      ? (["notifications-feed", namespace, credentialKey, appToken] as const)
      : null,
    () => fetchNotificationFeed({ appToken, kubeconfig, namespace }),
    {
      refreshInterval: NOTIFICATION_CR_REFRESH_INTERVAL_MS,
      shouldRetryOnError: false,
    }
  );
  const { mutate: refreshBrainFeed } = brainFeed;
  // Until the Brain feed answers, the cluster poll runs as in production;
  // a mock session pays one cluster request before the fixtures take over.
  const fixturePlatformItems = brainFeed.data?.platformItems;
  const crList = useNotificationCRList({
    enabled: fixturePlatformItems == null,
    kubeconfig,
    namespace,
  });
  const { mutate: refreshCRList } = crList;

  // The gift hint's observation point: a read that shows gift credit reports
  // it. The latch holds while a report is in flight or after one landed; a
  // failed report clears it so the next credits read (or a workspace or
  // credential change) tries again instead of leaving D4 missing for the
  // rest of the session. The producer dedupes by user, so a repeat is
  // harmless.
  const giftObservedFor = useRef<string | null>(null);
  const observeGift = useCallback(
    (giftMicroUnits: number) => {
      const key = `${namespace}|${credentialKey}`;
      if (
        !credentialsReady ||
        giftMicroUnits <= 0 ||
        giftObservedFor.current === key
      ) {
        return;
      }
      giftObservedFor.current = key;
      reportGiftCreditObservation(
        { appToken, kubeconfig, namespace },
        { giftMicroUnits }
      )
        .then(() => refreshBrainFeed())
        .catch(() => {
          if (giftObservedFor.current === key) {
            giftObservedFor.current = null;
          }
        });
    },
    [
      appToken,
      credentialKey,
      credentialsReady,
      kubeconfig,
      namespace,
      refreshBrainFeed,
    ]
  );
  // Account facts for the display layer: gift and usable credit plus whether
  // the account ever topped up. Both are account-scoped, so they key on the
  // credentials alone. Credits burn down, so they follow the inbox's own
  // cadence and every answered poll is a gift observation opportunity even
  // when nothing changed (SWR keeps equal `data` referentially stable);
  // top-up history only ever grows, so one read per session is the truth
  // for the session.
  const credits = useSWR(
    credentialsReady
      ? (["notifications-credits", credentialKey, appToken] as const)
      : null,
    () => loadAccountCredits({ appToken, kubeconfig }),
    {
      onSuccess: (data) => observeGift(data.giftMicroUnits),
      refreshInterval: NOTIFICATION_CR_REFRESH_INTERVAL_MS,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
  const toppedUp = useSWR(
    credentialsReady
      ? (["notifications-topped-up", credentialKey, appToken] as const)
      : null,
    () => loadHasToppedUp({ appToken, kubeconfig }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  // Unknown account state never hides a warning: the filter is on only once
  // both facts are in and say so.
  const giftOnly =
    credits.data != null &&
    toppedUp.data != null &&
    isGiftOnlyNewcomer({ ...credits.data, hasToppedUp: toppedUp.data });

  // Data already in SWR's cache answers without a fetch, so the first
  // render observes it here; later polls observe through `onSuccess`.
  const giftMicroUnits = credits.data?.giftMicroUnits ?? 0;
  useEffect(() => {
    observeGift(giftMicroUnits);
  }, [giftMicroUnits, observeGift]);

  const items = useMemo(() => {
    const crItems = fixturePlatformItems ?? crList.data?.items;
    if (crItems == null && brainFeed.data == null) {
      return EMPTY_ITEMS;
    }
    return mergeNotificationFeed({
      crItems: crItems ?? [],
      dbMessages: brainFeed.data?.messages ?? [],
      giftOnly,
      receipts: brainFeed.data?.receipts ?? [],
    });
  }, [brainFeed.data, crList.data, fixturePlatformItems, giftOnly]);

  const dispatchRead = useCallback(
    (targets: readonly AppNotification[]) => {
      if (targets.length === 0) {
        return;
      }
      const targetIds = targets.map((target) => target.id);
      setReadIds((previous) => {
        const next = new Set(previous);
        for (const id of targetIds) {
          next.add(id);
        }
        return next;
      });
      if (!credentialsReady) {
        return;
      }
      const plan = planReadDispatch(targets, subscription?.role);
      const credentials = { appToken, kubeconfig, namespace };
      // The receipt is the read state's source of truth (`readIds` is
      // session-only): a failed write rolls the optimistic ids back so the
      // dot returns and the user can click again, and says so once.
      postNotificationReadReceipts(credentials, plan.receiptIds)
        .then(() => refreshBrainFeed())
        .catch(() => {
          setReadIds((previous) => {
            const next = new Set(previous);
            for (const id of targetIds) {
              next.delete(id);
            }
            return next;
          });
          toast.error(
            targetIds.length === 1
              ? "Couldn't mark the notification as read. Try again."
              : "Couldn't mark notifications as read. Try again."
          );
        });
      if (fixturePlatformItems != null) {
        return;
      }
      // Desktop parity is best-effort: a 403 (Developer RBAC) or any other
      // failure is swallowed — the receipt already made the message read.
      for (const name of plan.crNames) {
        markNotificationCRRead({ kubeconfig, name, namespace })
          .then(() => refreshCRList())
          .catch(() => undefined);
      }
    },
    [
      appToken,
      credentialsReady,
      fixturePlatformItems,
      kubeconfig,
      namespace,
      refreshBrainFeed,
      refreshCRList,
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
    markManyRead: dispatchRead,
    markRead,
    readIds,
    unreadCount: countUnreadNotifications(items, readIds),
  };
}
