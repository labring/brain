"use client";

import { Skeleton } from "@workspace/ui/components/skeleton";
import { useAtomValue } from "jotai";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
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
  loadAccountBalance,
} from "@/features/billing/account-balance";
import {
  type AccountCredits,
  loadAccountCredits,
} from "@/features/billing/account-credits";
import { loadAiCredits } from "@/features/billing/billing-ai-credits";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import { formatBillingDateTime } from "@/features/billing/billing-datetime";
import { BillingFreeTurnsSection } from "@/features/billing/billing-free-turns-section";
import {
  BillingPlanChangeDialog,
  type BillingPlanChangeServices,
} from "@/features/billing/billing-plan-change-dialog";
import {
  BillingPlanCongratulationsDialog,
  useSettledPaymentCongratulations,
} from "@/features/billing/billing-plan-congratulations-dialog";
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
  BillingBalanceValue,
  BillingPlanSurface,
} from "@/features/billing/billing-plan-surface";
import {
  accountBalanceSwrKey,
  accountCreditsSwrKey,
  aiCreditsSwrKey,
  settleSubscriptionChange,
} from "@/features/billing/billing-subscription-settlement";
import type { BillingCurrency } from "@/features/billing/config-core";
import {
  type FreeChatTurnsUsage,
  fetchFreeChatTurnsUsage,
} from "@/features/chat/persistence/client";
import { observeSubscriptionChangeQuietly } from "@/features/notifications/subscription-change-observer";
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
  /** Injected by tests; production uses the checkout dialog's own defaults. */
  checkoutServices?: BillingPlanChangeServices;
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
  schedulePoll?: (callback: () => void, delay: number) => () => void;
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
  checkoutServices,
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
  schedulePoll,
  snapshot,
  stripeReturn = null,
}: BillingPlanWorkflowProps) {
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
  const congratulations = useSettledPaymentCongratulations();
  const {
    dismiss: dismissCongratulations,
    open: openCongratulations,
    recordSettledSnapshot,
  } = congratulations;

  // The mode parameter is consumed once per arrival: the state above handles
  // the deep-link mount, and this handles a later client-side navigation back
  // to ?mode=upgrade. Opening during render keeps the picker from painting a
  // frame without it. Stripping the parameter is a URL side effect, so it
  // stays in an effect — and runs whether or not the picker opened.
  const [consumedMode, setConsumedMode] = useState(initialMode);
  if (consumedMode !== initialMode) {
    setConsumedMode(initialMode);
    if (initialMode === "upgrade" && planDialogActionable) {
      setSelectedPlanId(null);
      setPlanDialogOpen(true);
    }
  }
  useEffect(() => {
    if (initialMode === "upgrade") {
      replaceUrl(currentUrlWithout(["mode"]));
    }
  }, [initialMode, replaceUrl]);

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
          // The redirect leg carries no quote, so it concludes without a
          // charged-today row.
          openCongratulations(nextSnapshot, null);
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
  }, [onRefreshSnapshot, openCongratulations, stripeReturn]);

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
    recordSettledSnapshot(await onRefreshSnapshot());
  }, [onRefreshSnapshot, recordSettledSnapshot]);
  const handleCongratulationsClose = useCallback(() => {
    dismissCongratulations();
    replaceUrl(currentUrlWithout(["stripeState", "payId", "workspaceId"]));
  }, [dismissCongratulations, replaceUrl]);

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
        onPaymentSuccess={congratulations.onPaymentSuccess}
        onSelectedPlanChange={setSelectedPlanId}
        onSubscriptionChanged={handleSubscriptionChanged}
        open={planDialogOpen}
        schedulePoll={schedulePoll}
        selectedPlanId={selectedPlanId}
        services={checkoutServices}
        snapshot={snapshot}
      />
      <BillingPlanCongratulationsDialog
        chargedMicroUnits={congratulations.chargedMicroUnits}
        currency={currency}
        onClose={handleCongratulationsClose}
        snapshot={congratulations.snapshot}
      />
    </>
  );
}

function accountBalanceContent(input: {
  balance: AccountBalance | undefined;
  credentialsReady: boolean;
  error: unknown;
  /** Undefined while loading or after a failed fetch — either renders the
   *  cash figure alone (no chip) with the debt voice withheld, since unseen
   *  credits could still cover the account. */
  giftCredits: AccountCredits | undefined;
  isLoading: boolean;
  /** Whether this workspace is Pay-As-You-Go — the only mode debt suspends. */
  payg: boolean;
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
    <BillingBalanceValue
      availableMicroUnits={
        input.balance.microUnits + (input.giftCredits?.usableMicroUnits ?? 0)
      }
      creditsResolved={input.giftCredits != null}
      currency={input.balance.currency}
      giftMicroUnits={input.giftCredits?.giftMicroUnits ?? 0}
      lifetimeDeductionMicroUnits={input.balance.lifetimeDeductionMicroUnits}
      payg={input.payg}
    />
  );
}

/**
 * The credits slot: the trial's "Free trial messages" allowance card and
 * the paid plans' AI Credits section share it, so upgrading naturally swaps
 * one for the other (ADR-0065). PAYG renders neither.
 */
function BillingCreditsSlot({
  credits,
  creditsError,
  creditsLoading,
  freeTurnsLoading,
  freeTurnsUsage,
  snapshot,
}: {
  credits: ComponentProps<typeof BillingAiCreditsSection>["credits"];
  creditsError: unknown;
  creditsLoading: boolean;
  freeTurnsLoading: boolean;
  freeTurnsUsage: FreeChatTurnsUsage | null;
  snapshot: BillingPlanSnapshot;
}) {
  if (snapshot.current.isActiveFreeTrial) {
    return (
      <BillingFreeTurnsSection
        expiresAt={snapshot.current.currentPeriodEndAt}
        usage={freeTurnsUsage}
        usageUnavailable={!freeTurnsLoading && freeTurnsUsage == null}
      />
    );
  }
  if (snapshot.current.isPayg) {
    return null;
  }
  return (
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
      ? accountBalanceSwrKey({ appToken, currency, kubeconfig })
      : null,
    () => loadAccountBalance({ appToken, currency, kubeconfig }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const { data: giftCredits } = useSWR(
    credentialsReady ? accountCreditsSwrKey({ appToken, kubeconfig }) : null,
    () => loadAccountCredits({ appToken, kubeconfig }),
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
      ? aiCreditsSwrKey({ appToken, kubeconfig, workspace })
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
  // The Free-allowance card reads Brain's own chat usage — the Billing
  // Area's only non-account-service data source (ADR-0065). The fetcher
  // resolves `null` on failure, which the card renders as quiet degradation.
  const { data: freeTurnsUsage, isLoading: freeTurnsLoading } = useSWR(
    credentialsReady && snapshot?.current.isActiveFreeTrial
      ? (["chat-free-turns", workspace, kubeconfig, appToken] as const)
      : null,
    () =>
      fetchFreeChatTurnsUsage({ appToken, kubeconfig, namespace: workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  // Read through refs so refreshPlanSnapshot's identity stays stable across
  // data updates — the checkout dialog's effects depend on it.
  const creditsBaselineRef = useRef<number | null>(null);
  useEffect(() => {
    creditsBaselineRef.current = credits?.totalMicroUnits ?? null;
  }, [credits]);
  const settlementCancelRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      settlementCancelRef.current?.();
    },
    []
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
      if (operator === "canceled") {
        // The receipt's observation point for cancellations (catalog B5).
        observeSubscriptionChangeQuietly({
          appToken,
          cancelled: {
            currentPeriodEndAt: current.currentPeriodEndAt,
            planName: current.planName,
          },
          kubeconfig,
          regionDomain: current.regionDomain,
          workspace: current.workspace,
        }).catch(() => undefined);
      }
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
      const settleWorkspace = targetWorkspace ?? workspace;
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
      // Every payment success funnels through here (checkout poll + Stripe
      // return), so this is the settlement point for the payment-sensitive
      // caches the snapshot refresh does not cover.
      settlementCancelRef.current?.();
      settlementCancelRef.current = settleSubscriptionChange({
        appToken,
        baselineTotalMicroUnits:
          settleWorkspace === workspace ? creditsBaselineRef.current : null,
        currency,
        kubeconfig,
        workspace: settleWorkspace,
      });
      // …and for the subscription-change receipt (catalog B5): the settled
      // transaction names what happened. Only the current workspace's inbox
      // is verifiable from here, so another workspace's change goes
      // unreceipted rather than landing in the wrong inbox.
      if (settleWorkspace === workspace) {
        observeSubscriptionChangeQuietly({
          appToken,
          kubeconfig,
          regionDomain: nextSnapshot.current.regionDomain,
          workspace,
        }).catch(() => undefined);
      }
      return nextSnapshot;
    },
    [appToken, currency, kubeconfig, refreshSnapshot, workspace]
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
            giftCredits,
            isLoading: balanceLoading,
            payg: snapshot.current.isPayg,
          })}
        </div>
      }
      cardManagementPending={cardManagementPending}
      credentials={{ appToken, kubeconfig }}
      credits={
        <BillingCreditsSlot
          credits={credits}
          creditsError={creditsError}
          creditsLoading={creditsLoading}
          freeTurnsLoading={freeTurnsLoading}
          freeTurnsUsage={freeTurnsUsage ?? null}
          snapshot={snapshot}
        />
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
