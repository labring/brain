"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { loadAccountBalanceTerms } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import { planUpgradeCeiling } from "@/features/billing/billing-plan-catalog";
import { loadBillingPlans } from "@/features/billing/billing-plan-data";
import { accountCreditsSwrKey } from "@/features/billing/billing-subscription-settlement";
import { loadWorkspaceQuotaData } from "@/features/billing/billing-usage-data";
import { observeWorkspaceQuotaSnapshotForInbox } from "@/features/notifications/quota-observation";
import { useWorkspaceSubscriptionSummary } from "@/features/shell/use-workspace-subscription-summary";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import type { StatusHintInputs } from "./status-hint-model";

/** States clear on their own; the inputs follow the inbox's polling cadence. */
export const STATUS_HINT_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * A PAYG workspace always has plans to subscribe to; a subscribed one asks
 * the catalog whether any step up remains. Unanswered reads stay unknown.
 */
function planCeilingFrom(
  subscription: { isPayg: boolean; planName: string } | undefined,
  plans: Parameters<typeof planUpgradeCeiling>[0] | undefined
): boolean | null {
  if (subscription == null) {
    return null;
  }
  if (subscription.isPayg) {
    return false;
  }
  if (plans == null) {
    return null;
  }
  return planUpgradeCeiling(plans, subscription.planName);
}

/**
 * The already-proxied reads every billing-state judgment evaluates from —
 * the subscription summary the App Sidebar already holds, the account's
 * cash and usable credits (the platform's debt formula), and the
 * workspace's resource quota. Shared by the status hint and the pre-deploy
 * wall so the banner and the blocked deploy entry read the same facts (the
 * SWR keys dedupe across both). A read that has not answered leaves its
 * state unknown — never lit, never cleared.
 */
export function useStatusHintInputs(): StatusHintInputs {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && workspace !== "";
  const credentialKey = kubeconfigCredentialKey(kubeconfig);

  const subscription = useWorkspaceSubscriptionSummary({
    refreshInterval: STATUS_HINT_REFRESH_INTERVAL_MS,
  });
  const swrOptions = {
    refreshInterval: STATUS_HINT_REFRESH_INTERVAL_MS,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  };
  const balance = useSWR(
    credentialsReady
      ? (["status-hint-balance", credentialKey, appToken] as const)
      : null,
    () => loadAccountBalanceTerms({ appToken, kubeconfig }),
    swrOptions
  );
  // The settlement flow refreshes this key after a payment, so a top-up
  // that lands through Brain clears Account Debt without waiting a cycle.
  const credits = useSWR(
    credentialsReady ? accountCreditsSwrKey({ appToken, kubeconfig }) : null,
    () => loadAccountCredits({ appToken, kubeconfig }),
    swrOptions
  );
  // Every quota poll is also the quota-exhausted producer's observation
  // point (A1): the inbox observes on the banner's cadence, so the two
  // cannot disagree for minutes, and a recovery between chat turns still
  // releases the live key.
  const quota = useSWR(
    credentialsReady
      ? (["status-hint-quota", workspace, credentialKey, appToken] as const)
      : null,
    () => loadWorkspaceQuotaData({ appToken, kubeconfig, workspace }),
    {
      ...swrOptions,
      onSuccess: ({ snapshot }) => {
        if (snapshot == null) {
          return;
        }
        observeWorkspaceQuotaSnapshotForInbox(
          {
            appToken,
            kubeconfig,
            namespace: workspace,
          },
          snapshot
        ).catch(() => undefined);
      },
    }
  );
  // The quota reminders' plan CTA steps aside only on a confirmed plan
  // ceiling, so the catalog rides the same cadence; an unanswered read
  // leaves the ceiling unknown, never assumed.
  const plans = useSWR(
    credentialsReady
      ? (["status-hint-plans", credentialKey, appToken] as const)
      : null,
    () => loadBillingPlans({ appToken, kubeconfig }),
    swrOptions
  );

  // Trial-expiry is a clock state as much as a data state: the window opens
  // and the title counts down while the subscription payload stays the same,
  // so the clock advances on the polling cadence too.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, STATUS_HINT_REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const balanceTerms = balance.data;
  const usableCreditMicroUnits = credits.data?.usableMicroUnits;
  const quotaRows = quota.data?.rows;
  const subscriptionSummary = subscription.data;
  const planCatalog = plans.data;
  return useMemo(
    () => ({
      availableBalanceMicroUnits:
        balanceTerms == null || usableCreditMicroUnits == null
          ? null
          : balanceTerms.cashMicroUnits + usableCreditMicroUnits,
      lifetimeDeductionMicroUnits:
        balanceTerms?.lifetimeDeductionMicroUnits ?? null,
      now,
      planCeiling: planCeilingFrom(subscriptionSummary, planCatalog),
      quota: quotaRows ?? null,
      subscription: subscriptionSummary ?? null,
    }),
    [
      balanceTerms,
      now,
      planCatalog,
      quotaRows,
      subscriptionSummary,
      usableCreditMicroUnits,
    ]
  );
}
