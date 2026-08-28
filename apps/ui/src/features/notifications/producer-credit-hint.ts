import type { NotificationStore } from "./store";

/**
 * The $1 gift hint producer (catalog row D4): the first time a new user's
 * gift credit is visible during one of their requests, exactly one
 * reassuring entry appears — per user, not per workspace. The dedupe key
 * carries the bare user uid and the row is account-scoped (`userUid` set),
 * so it follows the person into every workspace's inbox; `namespace` only
 * records where it was first observed. The key is never released: the gift
 * is reissued monthly, the welcome is said once.
 */

export const CREDIT_HINT_DEDUPE_PREFIX = "credit-hint";

export function creditHintDedupeKey(userUid: string): string {
  return `${CREDIT_HINT_DEDUPE_PREFIX}:${userUid}`;
}

export interface GiftCreditObservationResult {
  produced: boolean;
}

export type GiftCreditObservationStore = Pick<NotificationStore, "produce">;

export async function observeGiftCreditForNotifications(
  store: GiftCreditObservationStore,
  input: {
    giftMicroUnits: number;
    namespace: string;
    now?: Date;
    userUid: string;
  }
): Promise<GiftCreditObservationResult> {
  const namespace = input.namespace.trim();
  const userUid = input.userUid.trim();
  if (
    namespace === "" ||
    userUid === "" ||
    !(Number.isFinite(input.giftMicroUnits) && input.giftMicroUnits > 0)
  ) {
    return { produced: false };
  }
  const produced = await store.produce({
    dedupeKey: creditHintDedupeKey(userUid),
    kind: "credit-hint",
    namespace,
    now: input.now,
    payload: { giftMicroUnits: input.giftMicroUnits, kind: "credit-hint" },
    userUid,
  });
  return { produced };
}
