"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { useAtomValue } from "jotai";
import { CircleCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  type AccountBalance,
  formatAccountBalance,
  loadAccountBalance,
} from "@/features/billing/account-balance";
import { loadAiCredits } from "@/features/billing/billing-ai-credits";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import { formatBillingDateTime } from "@/features/billing/billing-datetime";
import { BillingPlanChangeDialog } from "@/features/billing/billing-plan-change-dialog";
import {
  type BillingPlanSnapshot,
  cancelSubscriptionInvoice,
  createBillingCardManagementSession,
  loadBillingPlanSnapshot,
  type SubscriptionLifecycleAction,
  type SubscriptionLifecycleOutcome,
  subscriptionLifecycleAllowsBillingActions,
  updateSubscriptionLifecycle,
} from "@/features/billing/billing-plan-data";
import {
  BillingAiCreditsSection,
  BillingPlanSurface,
} from "@/features/billing/billing-plan-surface";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { errorDescription, toastErrorDetail } from "@/lib/toast-utils";

export interface BillingStripeReturn {
  payId: string;
  workspaceId: string;
}

interface BillingPlanWorkflowProps {
  actionPending?: SubscriptionLifecycleAction | null;
  balance: ReactNode;
  cardManagementPending?: boolean;
  credentials: BillingCredentials;
  credits?: ReactNode;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  initialMode?: "upgrade" | null;
  invoiceCancellationPending?: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  onLifecycleAction?: (
    operator: SubscriptionLifecycleAction
  ) => Promise<SubscriptionLifecycleOutcome> | undefined;
  onManageCard?: () => void;
  onRefreshSnapshot: (workspaceId?: string) => Promise<BillingPlanSnapshot>;
  replaceUrl: (url: string) => void;
  snapshot: BillingPlanSnapshot;
  stripeReturn?: BillingStripeReturn | null;
}

function currentUrlWithout(parameters: readonly string[]): string {
  const url = new URL(window.location.href);
  for (const parameter of parameters) {
    url.searchParams.delete(parameter);
  }
  const search = url.searchParams.toString();
  return `${url.pathname}${search === "" ? "" : `?${search}`}${url.hash}`;
}

export function BillingPlanWorkflow({
  actionPending = null,
  balance,
  cardManagementPending = false,
  credentials,
  credits = null,
  currency,
  gpuEnabled,
  initialMode = null,
  invoiceCancellationPending = false,
  onCancelInvoice,
  onLifecycleAction,
  onManageCard,
  onRefreshSnapshot,
  replaceUrl,
  snapshot,
  stripeReturn = null,
}: BillingPlanWorkflowProps) {
  const modeConsumedRef = useRef(false);
  const stripeAcknowledgedKeyRef = useRef<string | null>(null);
  const stripeRefreshRef = useRef<{
    key: string;
    request: Promise<BillingPlanSnapshot>;
  } | null>(null);
  // A deep link must not open a picker whose cards carry no actions — the
  // same gate the dialog's own entry points use. The mode parameter is
  // consumed either way.
  const planDialogActionable =
    snapshot.current.canManage &&
    subscriptionLifecycleAllowsBillingActions(snapshot.current.lifecycle);
  const [planDialogOpen, setPlanDialogOpen] = useState(
    initialMode === "upgrade" && planDialogActionable
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [congratulationsSnapshot, setCongratulationsSnapshot] =
    useState<BillingPlanSnapshot | null>(null);

  useEffect(() => {
    if (initialMode !== "upgrade") {
      modeConsumedRef.current = false;
      return;
    }
    if (modeConsumedRef.current) {
      return;
    }
    modeConsumedRef.current = true;
    if (planDialogActionable) {
      setSelectedPlanId(null);
      setPlanDialogOpen(true);
    }
    replaceUrl(currentUrlWithout(["mode"]));
  }, [initialMode, planDialogActionable, replaceUrl]);

  useEffect(() => {
    if (stripeReturn == null) {
      return;
    }

    const key = `${stripeReturn.workspaceId}:${stripeReturn.payId}`;
    if (stripeAcknowledgedKeyRef.current === key) {
      return;
    }
    let refresh = stripeRefreshRef.current;
    if (refresh?.key !== key) {
      refresh = {
        key,
        request: onRefreshSnapshot(stripeReturn.workspaceId),
      };
      stripeRefreshRef.current = refresh;
    }

    let active = true;
    refresh.request
      .then((nextSnapshot) => {
        if (active) {
          stripeAcknowledgedKeyRef.current = key;
          // Close and open in the same commit: the plan dialog's backdrop
          // hands off to the congratulations one without a bright gap.
          setPlanDialogOpen(false);
          setSelectedPlanId(null);
          setCongratulationsSnapshot(nextSnapshot);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPlanDialogOpen(false);
          setSelectedPlanId(null);
          toastErrorDetail(
            "Payment succeeded, but the Plan could not be refreshed.",
            errorDescription(
              error,
              "Refresh the page to load the updated subscription."
            )
          );
        }
      });
    return () => {
      active = false;
    };
  }, [onRefreshSnapshot, stripeReturn]);

  const handlePlanDialogOpenChange = useCallback((open: boolean) => {
    setPlanDialogOpen(open);
    if (!open) {
      setSelectedPlanId(null);
    }
  }, []);
  const handlePlanChange = useCallback((planId: string | null) => {
    setSelectedPlanId(planId);
    setPlanDialogOpen(true);
  }, []);
  const handleSubscriptionChanged = useCallback(async () => {
    await onRefreshSnapshot();
  }, [onRefreshSnapshot]);
  const handleCongratulationsClose = useCallback(() => {
    setCongratulationsSnapshot(null);
    replaceUrl(currentUrlWithout(["stripeState", "payId", "workspaceId"]));
  }, [replaceUrl]);

  return (
    <>
      <BillingPlanSurface
        actionPending={actionPending}
        balance={balance}
        cardManagementPending={cardManagementPending}
        credits={credits}
        currency={currency}
        invoiceCancellationPending={invoiceCancellationPending}
        onCancelInvoice={onCancelInvoice}
        onLifecycleAction={onLifecycleAction}
        onManageCard={onManageCard}
        onPlanChange={handlePlanChange}
        snapshot={snapshot}
      />
      <BillingPlanChangeDialog
        credentials={credentials}
        currency={currency}
        gpuEnabled={gpuEnabled}
        onManageCard={onManageCard}
        onOpenChange={handlePlanDialogOpenChange}
        onSelectedPlanChange={setSelectedPlanId}
        onSubscriptionChanged={handleSubscriptionChanged}
        open={planDialogOpen}
        selectedPlanId={selectedPlanId}
        snapshot={snapshot}
      />
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            handleCongratulationsClose();
          }
        }}
        open={congratulationsSnapshot != null}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CircleCheck aria-hidden className="size-7" />
            </div>
            <DialogTitle>Congratulations!</DialogTitle>
            <DialogDescription>
              {congratulationsSnapshot == null
                ? ""
                : `${congratulationsSnapshot.current.workspace} is now on ${congratulationsSnapshot.current.planName}.`}
            </DialogDescription>
          </DialogHeader>
          {congratulationsSnapshot == null ? null : (
            <div className="grid gap-2 sm:grid-cols-2">
              {congratulationsSnapshot.current.resources.map((resource) => (
                <div
                  className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
                  key={resource.label}
                >
                  <CircleCheck aria-hidden className="size-4 text-primary" />
                  <span>
                    {resource.label}: {resource.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <AppButton onClick={handleCongratulationsClose}>Done</AppButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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

export function BillingPlan({
  currency,
  gpuEnabled,
  initialMode = null,
  replaceUrl,
  stripeReturn = null,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
  initialMode?: "upgrade" | null;
  replaceUrl: (url: string) => void;
  stripeReturn?: BillingStripeReturn | null;
}) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const workspace = useAtomValue(namespaceAtom).trim();
  const [actionPending, setActionPending] =
    useState<SubscriptionLifecycleAction | null>(null);
  const [cardManagementPending, setCardManagementPending] = useState(false);
  const [invoiceCancellationPending, setInvoiceCancellationPending] =
    useState(false);
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
  const creditsKey =
    credentialsReady && snapshot != null && !snapshot.current.isPayg
      ? (["billing-ai-credits", workspace, kubeconfig, appToken] as const)
      : null;
  const {
    data: credits,
    error: creditsError,
    isLoading: creditsLoading,
  } = useSWR(
    creditsKey,
    () => loadAiCredits({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const updateLifecycle = async (
    operator: SubscriptionLifecycleAction
  ): Promise<SubscriptionLifecycleOutcome> => {
    if (
      snapshot == null ||
      actionPending != null ||
      !subscriptionLifecycleAllowsBillingActions(snapshot.current.lifecycle)
    ) {
      return { ok: false, message: "The subscription could not be updated." };
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
      return { ok: true };
    } catch (error) {
      const message = errorDescription(
        error,
        "The subscription could not be updated."
      );
      // Cancel failures render inline in the confirm dialog, which stays open.
      if (operator !== "canceled") {
        toastErrorDetail("Could not resume subscription.", message);
      }
      return { message, ok: false };
    } finally {
      setActionPending(null);
    }
  };

  const manageCard = async () => {
    const current = snapshot?.current;
    if (
      cardManagementPending ||
      current == null ||
      !subscriptionLifecycleAllowsBillingActions(current.lifecycle)
    ) {
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

  const cancelInvoice = async (invoiceId: string) => {
    const current = snapshot?.current;
    if (
      invoiceCancellationPending ||
      current == null ||
      !subscriptionLifecycleAllowsBillingActions(current.lifecycle)
    ) {
      return;
    }

    setInvoiceCancellationPending(true);
    try {
      await cancelSubscriptionInvoice({
        appToken,
        invoiceId,
        kubeconfig,
        regionDomain: current.regionDomain,
        workspace: current.workspace,
      });
      await refreshSnapshot();
      toast.success("Unpaid invoice cancelled.");
    } catch (error) {
      toastErrorDetail(
        "Could not cancel the unpaid invoice.",
        errorDescription(error, "The invoice could not be cancelled.")
      );
    } finally {
      setInvoiceCancellationPending(false);
    }
  };

  const refreshPlanSnapshot = useCallback(
    async (targetWorkspace?: string) => {
      const nextSnapshot =
        targetWorkspace == null || targetWorkspace === workspace
          ? await refreshSnapshot()
          : await loadBillingPlanSnapshot({
              appToken,
              kubeconfig,
              workspace: targetWorkspace,
            });
      if (nextSnapshot == null) {
        throw new Error("The refreshed subscription is unavailable.");
      }
      return nextSnapshot;
    },
    [appToken, kubeconfig, refreshSnapshot, workspace]
  );

  if (!credentialsReady || snapshotLoading) {
    return (
      <div
        aria-label="Loading Plan"
        className="flex flex-col gap-6"
        data-slot="billing-plan-surface"
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
    <BillingPlanWorkflow
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
      credentials={{ appToken, kubeconfig }}
      credits={
        snapshot.current.isPayg ? null : (
          <BillingAiCreditsSection
            credits={credits}
            error={creditsError}
            isLoading={creditsLoading}
            planIncludesCredits={snapshot.current.resources.some(
              (resource) => resource.label === "AI Credits"
            )}
            resetAt={
              snapshot.current.periodEndVoice === "silent"
                ? "-"
                : formatBillingDateTime(snapshot.current.currentPeriodEndAt)
            }
            resetLabel={
              snapshot.current.periodEndVoice === "expiry" ? "Ends:" : "Resets:"
            }
          />
        )
      }
      currency={currency}
      gpuEnabled={gpuEnabled}
      initialMode={initialMode}
      invoiceCancellationPending={invoiceCancellationPending}
      onCancelInvoice={cancelInvoice}
      onLifecycleAction={updateLifecycle}
      onManageCard={manageCard}
      onRefreshSnapshot={refreshPlanSnapshot}
      replaceUrl={replaceUrl}
      snapshot={snapshot}
      stripeReturn={stripeReturn}
    />
  );
}

export default function BillingPlanRoute({
  currency,
  gpuEnabled,
  initialMode = null,
  stripeReturn = null,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
  initialMode?: "upgrade" | null;
  stripeReturn?: BillingStripeReturn | null;
}) {
  const router = useRouter();
  return (
    <BillingPlan
      currency={currency}
      gpuEnabled={gpuEnabled}
      initialMode={initialMode}
      replaceUrl={(url) => {
        router.replace(url, { scroll: false });
      }}
      stripeReturn={stripeReturn}
    />
  );
}
