import { mutate } from "swr";

import {
  type AccountBalance,
  loadAccountBalance,
} from "@/features/billing/account-balance";
import {
  type AccountCredits,
  loadAccountCredits,
} from "@/features/billing/account-credits";
import {
  type AiCredits,
  loadAiCredits,
} from "@/features/billing/billing-ai-credits";
import type { BillingFetch } from "@/features/billing/billing-data-client";
import type { BillingCurrency } from "@/features/billing/config-core";

export const SETTLEMENT_POLL_INTERVAL_MS = 3000;
export const SETTLEMENT_TIMEOUT_MS = 30_000;

export function accountBalanceSwrKey(credentials: {
  appToken: string;
  currency: BillingCurrency;
  kubeconfig: string;
}) {
  return [
    "billing-account-balance",
    credentials.currency,
    credentials.kubeconfig,
    credentials.appToken,
  ] as const;
}

export function accountCreditsSwrKey(credentials: {
  appToken: string;
  kubeconfig: string;
}) {
  return [
    "billing-account-credits",
    credentials.kubeconfig,
    credentials.appToken,
  ] as const;
}

export function aiCreditsSwrKey(credentials: {
  appToken: string;
  kubeconfig: string;
  workspace: string;
}) {
  return [
    "billing-ai-credits",
    credentials.workspace,
    credentials.kubeconfig,
    credentials.appToken,
  ] as const;
}

export interface SubscriptionSettlementInput {
  appToken: string;
  /**
   * The AI Credits total currently on screen, when the caller knows it.
   * The poll stops early once the fetched total moves away from it.
   */
  baselineTotalMicroUnits?: number | null;
  currency: BillingCurrency;
  fetch?: BillingFetch;
  intervalMs?: number;
  kubeconfig: string;
  timeoutMs?: number;
  workspace: string;
}

/**
 * Refresh the payment-sensitive SWR caches after a subscription change
 * succeeds. Payment completion does not mean the subscription's effects have
 * landed: AI Credits are granted by a downstream account-service task, so a
 * single refetch can still read the pre-change allowance. Account Balance is
 * refetched once; AI Credits are polled until the total moves off the
 * baseline or the window closes, and every poll writes the fetched truth
 * into the cache either way.
 *
 * Returns a cancel function — call it on unmount or when a newer settlement
 * supersedes this one.
 */
export function settleSubscriptionChange({
  appToken,
  baselineTotalMicroUnits = null,
  currency,
  fetch = globalThis.fetch,
  intervalMs = SETTLEMENT_POLL_INTERVAL_MS,
  kubeconfig,
  timeoutMs = SETTLEMENT_TIMEOUT_MS,
  workspace,
}: SubscriptionSettlementInput): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // A failed refetch keeps the previous cached balance.
  mutate<AccountBalance>(
    accountBalanceSwrKey({ appToken, currency, kubeconfig }),
    loadAccountBalance({ appToken, currency, kubeconfig }, fetch),
    { revalidate: false }
  ).catch(() => undefined);

  // Gift credits feed the same Account Balance figure (a plan purchase can
  // grant plan credits upstream), so they refresh alongside it.
  mutate<AccountCredits>(
    accountCreditsSwrKey({ appToken, kubeconfig }),
    loadAccountCredits({ appToken, kubeconfig }, fetch),
    { revalidate: false }
  ).catch(() => undefined);

  const creditsKey = aiCreditsSwrKey({ appToken, kubeconfig, workspace });
  const startedAt = Date.now();
  let baseline = baselineTotalMicroUnits;

  const poll = async () => {
    let next: AiCredits | undefined;
    try {
      next = await mutate<AiCredits>(
        creditsKey,
        loadAiCredits({ appToken, kubeconfig, workspace }, fetch),
        { revalidate: false }
      );
    } catch {
      // Transient failure: the cache keeps its previous value; keep polling.
    }
    if (cancelled) {
      return;
    }
    if (next != null) {
      if (baseline == null) {
        baseline = next.totalMicroUnits;
      } else if (next.totalMicroUnits !== baseline) {
        return;
      }
    }
    if (Date.now() - startedAt + intervalMs > timeoutMs) {
      return;
    }
    timer = setTimeout(() => {
      poll().catch(() => undefined);
    }, intervalMs);
  };
  poll().catch(() => undefined);

  return () => {
    cancelled = true;
    if (timer != null) {
      clearTimeout(timer);
    }
  };
}
