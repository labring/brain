import type { NotificationStore } from "./store";
import type { SubscriptionChange } from "./types";

/**
 * The subscription-change receipt producer (catalog row B5): one fact-only
 * entry per successful upgrade, downgrade, or cancellation, written at the
 * transaction observation point. The platform's transaction id is the
 * identity — the same change observed again (a checkout poll and the Stripe
 * return leg both settle the same payment) writes nothing. Never released:
 * a receipt records history, it has no recovery.
 */

export const SUBSCRIPTION_CHANGE_DEDUPE_PREFIX = "subscription-change";

export function subscriptionChangeDedupeKey(
  namespace: string,
  transactionId: string
): string {
  return `${SUBSCRIPTION_CHANGE_DEDUPE_PREFIX}:${namespace}:${transactionId}`;
}

export interface SubscriptionChangeObservationResult {
  produced: boolean;
}

export type SubscriptionChangeObservationStore = Pick<
  NotificationStore,
  "produce"
>;

export async function observeSubscriptionChangeForNotifications(
  store: SubscriptionChangeObservationStore,
  input: {
    change: SubscriptionChange;
    effectiveAt?: string;
    namespace: string;
    now?: Date;
    planName: string;
    transactionId: string;
  }
): Promise<SubscriptionChangeObservationResult> {
  const namespace = input.namespace.trim();
  const transactionId = input.transactionId.trim();
  const planName = input.planName.trim();
  if (namespace === "" || transactionId === "" || planName === "") {
    return { produced: false };
  }
  const produced = await store.produce({
    dedupeKey: subscriptionChangeDedupeKey(namespace, transactionId),
    kind: "subscription-change",
    namespace,
    now: input.now,
    payload: {
      change: input.change,
      ...(input.effectiveAt == null ? {} : { effectiveAt: input.effectiveAt }),
      kind: "subscription-change",
      planName,
    },
  });
  return { produced };
}
