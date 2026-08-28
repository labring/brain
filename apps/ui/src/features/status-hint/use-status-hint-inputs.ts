"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { loadAccountBalanceMicroUnits } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import { accountCreditsSwrKey } from "@/features/billing/billing-subscription-settlement";
import { loadWorkspaceQuotaUsage } from "@/features/billing/billing-usage-data";
import { observeWorkspaceQuotaForInbox } from "@/features/notifications/quota-observation";
import { useWorkspaceSubscriptionSummary } from "@/features/shell/use-workspace-subscription-summary";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

import type { StatusHintInputs } from "./status-hint-model";

/** States clear on their own; the inputs follow the inbox's polling cadence. */
export const STATUS_HINT_REFRESH_INTERVAL_MS = 5 * 60_000;

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
    () => loadAccountBalanceMicroUnits({ appToken, kubeconfig }),
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
    () => loadWorkspaceQuotaUsage({ appToken, kubeconfig, workspace }),
    {
      ...swrOptions,
      onSuccess: () => {
        observeWorkspaceQuotaForInbox({
          appToken,
          kubeconfig,
          namespace: workspace,
        }).catch(() => undefined);
      },
    }
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

  const balanceMicroUnits = balance.data;
  const usableCreditMicroUnits = credits.data?.usableMicroUnits;
  const quotaRows = quota.data;
  const subscriptionSummary = subscription.data;
  return useMemo(
    () => ({
      availableBalanceMicroUnits:
        balanceMicroUnits == null || usableCreditMicroUnits == null
          ? null
          : balanceMicroUnits + usableCreditMicroUnits,
      now,
      quota: quotaRows ?? null,
      subscription: subscriptionSummary ?? null,
    }),
    [
      balanceMicroUnits,
      now,
      quotaRows,
      subscriptionSummary,
      usableCreditMicroUnits,
    ]
  );
}
