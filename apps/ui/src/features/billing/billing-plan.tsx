"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { useAtomValue } from "jotai";
import type { ReactNode } from "react";
import useSWR from "swr";
import {
  type AccountBalance,
  formatAccountBalance,
  loadAccountBalance,
} from "@/features/billing/account-balance";
import { BillingPlanSurface } from "@/features/billing/billing-plan-surface";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom } from "@/lib/auth-store";

function accountBalanceContent(input: {
  balance: AccountBalance | undefined;
  credentialsReady: boolean;
  error: unknown;
  isLoading: boolean;
}): ReactNode {
  if (!input.credentialsReady || input.isLoading) {
    return (
      <Skeleton aria-label="Loading Account Balance" className="h-8 w-28" />
    );
  }
  if (input.error != null) {
    return (
      <p className="text-destructive text-sm" role="alert">
        Account Balance is unavailable.
      </p>
    );
  }
  if (input.balance == null) {
    return null;
  }
  return (
    <p className="font-semibold text-2xl text-foreground tabular-nums">
      {formatAccountBalance(input.balance)}
    </p>
  );
}

export default function BillingPlan({
  currency,
}: {
  currency: BillingCurrency;
}) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const credentialsReady = appToken.trim() !== "" && kubeconfig.trim() !== "";
  const { data, error, isLoading } = useSWR(
    credentialsReady
      ? (["billing-account-balance", currency, kubeconfig, appToken] as const)
      : null,
    () => loadAccountBalance({ appToken, currency, kubeconfig }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return (
    <BillingPlanSurface
      balance={
        <div aria-live="polite">
          {accountBalanceContent({
            balance: data,
            credentialsReady,
            error,
            isLoading,
          })}
        </div>
      }
    />
  );
}
