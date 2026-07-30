"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { useAtomValue } from "jotai";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  type AccountBalance,
  formatAccountBalance,
  loadAccountBalance,
} from "@/features/billing/account-balance";
import {
  createBillingCardManagementSession,
  loadBillingPlanSnapshot,
  type SubscriptionLifecycleAction,
  updateSubscriptionLifecycle,
} from "@/features/billing/billing-plan-data";
import { BillingPlanSurface } from "@/features/billing/billing-plan-surface";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

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
  const workspace = useAtomValue(namespaceAtom).trim();
  const [actionPending, setActionPending] =
    useState<SubscriptionLifecycleAction | null>(null);
  const [cardManagementPending, setCardManagementPending] = useState(false);
  const credentialsReady =
    appToken.trim() !== "" && kubeconfig.trim() !== "" && workspace !== "";
  const {
    data: balance,
    error: balanceError,
    isLoading: balanceLoading,
  } = useSWR(
    credentialsReady
      ? (["billing-account-balance", currency, kubeconfig, appToken] as const)
      : null,
    () => loadAccountBalance({ appToken, currency, kubeconfig }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const {
    data: snapshot,
    error: snapshotError,
    isLoading: snapshotLoading,
    mutate: refreshSnapshot,
  } = useSWR(
    credentialsReady
      ? (["billing-plan-snapshot", workspace, kubeconfig, appToken] as const)
      : null,
    () => loadBillingPlanSnapshot({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const updateLifecycle = async (operator: SubscriptionLifecycleAction) => {
    if (snapshot == null || actionPending != null) {
      return;
    }

    const { current } = snapshot;
    setActionPending(operator);
    try {
      await updateSubscriptionLifecycle({
        appToken,
        kubeconfig,
        operator,
        payMethod: current.payMethod,
        planName: current.planName,
        regionDomain: current.regionDomain,
        workspace: current.workspace,
      });
      await refreshSnapshot();
      toast.success(
        operator === "canceled"
          ? "Subscription cancellation scheduled."
          : "Subscription resumed."
      );
    } catch (error) {
      toastErrorDetail(
        operator === "canceled"
          ? "Could not cancel subscription."
          : "Could not resume subscription.",
        errorDescription(error, "The subscription could not be updated.")
      );
    } finally {
      setActionPending(null);
    }
  };

  const manageCard = async () => {
    const current = snapshot?.current;
    if (cardManagementPending || current == null) {
      return;
    }

    const managementWindow = window.open("about:blank", "_blank");
    if (managementWindow == null) {
      toastErrorDetail(
        "Could not open card management.",
        "The card management page was blocked."
      );
      return;
    }
    managementWindow.opener = null;

    setCardManagementPending(true);
    try {
      const managementUrl = await createBillingCardManagementSession({
        appToken,
        kubeconfig,
        regionDomain: current.regionDomain,
        workspace: current.workspace,
      });
      managementWindow.location.replace(managementUrl);
    } catch (error) {
      managementWindow.close();
      toastErrorDetail(
        "Could not open card management.",
        errorDescription(
          error,
          "The card management page could not be created."
        )
      );
    } finally {
      setCardManagementPending(false);
    }
  };

  if (!credentialsReady || snapshotLoading) {
    return (
      <div
        aria-label="Loading Plan"
        className="flex flex-col gap-6 pb-16"
        role="status"
      >
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (snapshot == null) {
    return (
      <div className="py-16 text-center" role="alert">
        <p className="font-medium text-foreground">Plan is unavailable.</p>
        <p className="mt-1 text-muted-foreground text-sm">
          {errorDescription(
            snapshotError,
            "The billing service could not be reached."
          )}
        </p>
      </div>
    );
  }

  return (
    <BillingPlanSurface
      actionPending={actionPending}
      balance={
        <div aria-live="polite">
          {accountBalanceContent({
            balance,
            credentialsReady,
            error: balanceError,
            isLoading: balanceLoading,
          })}
        </div>
      }
      cardManagementPending={cardManagementPending}
      currency={currency}
      onLifecycleAction={updateLifecycle}
      onManageCard={manageCard}
      snapshot={snapshot}
    />
  );
}
