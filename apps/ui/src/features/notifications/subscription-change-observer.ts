import {
  loadSubscriptionTransactionStatus,
  type SubscriptionTransactionStatus,
} from "@/features/billing/billing-plan-data";

import {
  type NotificationClientCredentials,
  reportSubscriptionChangeObservation,
} from "./client";
import type { SubscriptionChangeObservationRequest } from "./types";

/**
 * The client-side observation point for subscription-change receipts
 * (catalog B5): after a change settles on the Plan view, the last
 * transaction says what actually happened and names the transaction that
 * keys the receipt. Pure derivations here; the quiet observer is best-effort
 * and never fails the billing flow that called it.
 */

/**
 * An upgrade (or a first subscription from PAYG, which the product voices as
 * an upgrade) is a change once its payment completed; an unpaid invoice is
 * not. A downgrade lands at period end, so its scheduled transaction already
 * is the change and carries the effective date. Renewals and lifecycle
 * transactions are not receipts.
 */
export function subscriptionChangeReceiptFromTransaction(
  transaction: SubscriptionTransactionStatus | null
): SubscriptionChangeObservationRequest | null {
  if (
    transaction == null ||
    transaction.id === "" ||
    transaction.planName === ""
  ) {
    return null;
  }
  switch (transaction.operator) {
    case "created":
    case "upgraded":
      return transaction.status === "completed"
        ? {
            change: "upgraded",
            planName: transaction.planName,
            transactionId: transaction.id,
          }
        : null;
    case "downgraded":
      return transaction.status === "pending" ||
        transaction.status === "completed"
        ? {
            change: "downgraded",
            ...(transaction.startAt == null
              ? {}
              : { effectiveAt: transaction.startAt }),
            planName: transaction.planName,
            transactionId: transaction.id,
          }
        : null;
    default:
      return null;
  }
}

/**
 * A cancellation keeps the plan until period end. The platform's transaction
 * keys it when one was recorded; otherwise the period end is the natural
 * identity — cancelling the same period twice is one event.
 */
export function cancellationReceipt(input: {
  currentPeriodEndAt: string;
  planName: string;
  transaction: SubscriptionTransactionStatus | null;
}): SubscriptionChangeObservationRequest {
  const recorded =
    input.transaction?.operator === "canceled" && input.transaction.id !== ""
      ? input.transaction.id
      : `cancel:${input.currentPeriodEndAt}`;
  return {
    change: "cancelled",
    effectiveAt: input.currentPeriodEndAt,
    planName: input.planName,
    transactionId: recorded,
  };
}

export interface SubscriptionChangeObservationInput {
  appToken: string;
  /** Set when the change was an explicit cancellation (no payment settles). */
  cancelled?: { currentPeriodEndAt: string; planName: string };
  kubeconfig: string;
  regionDomain: string;
  workspace: string;
}

export interface SubscriptionChangeObserverDependencies {
  loadTransaction?: typeof loadSubscriptionTransactionStatus;
  report?: (
    credentials: NotificationClientCredentials,
    observation: SubscriptionChangeObservationRequest
  ) => Promise<void>;
}

/** Best-effort: reads the last transaction, reports the receipt, swallows everything. */
export async function observeSubscriptionChangeQuietly(
  input: SubscriptionChangeObservationInput,
  dependencies: SubscriptionChangeObserverDependencies = {}
): Promise<void> {
  const loadTransaction =
    dependencies.loadTransaction ?? loadSubscriptionTransactionStatus;
  const report = dependencies.report ?? reportSubscriptionChangeObservation;
  try {
    const transaction = await loadTransaction({
      appToken: input.appToken,
      kubeconfig: input.kubeconfig,
      regionDomain: input.regionDomain,
      workspace: input.workspace,
    }).catch(() => null);
    const observation =
      input.cancelled == null
        ? subscriptionChangeReceiptFromTransaction(transaction)
        : cancellationReceipt({ ...input.cancelled, transaction });
    if (observation == null) {
      return;
    }
    await report(
      {
        appToken: input.appToken,
        kubeconfig: input.kubeconfig,
        namespace: input.workspace,
      },
      observation
    );
  } catch {
    // A receipt is a nicety; the billing flow that settled must not notice.
  }
}
