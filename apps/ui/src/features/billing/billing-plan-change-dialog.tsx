"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { Badge } from "@workspace/ui/components/badge";
import { Separator } from "@workspace/ui/components/separator";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleCheck,
  CircleCheckBig,
  CreditCard,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import {
  type BillingPlanSnapshot,
  cancelSubscriptionInvoice,
  checkSubscriptionDowngrade,
  createSubscriptionPlanPayment,
  loadSubscriptionTransactionStatus,
  loadSubscriptionUpgradeQuote,
  type SubscriptionDowngradeCheck,
  type SubscriptionPlanCheckout,
  SubscriptionPromotionCodeError,
  type SubscriptionTransactionStatus,
  type SubscriptionUpgradeQuote,
} from "@/features/billing/billing-plan-data";
import type { BillingCurrency } from "@/features/billing/config-core";
import { errorDescription } from "@/lib/toast-utils";

interface CheckoutWindowHandle {
  close: () => void;
  navigate: (url: string) => void;
}

interface UpgradeQuoteInput extends BillingCredentials {
  planName: string;
  promotionCode?: string;
  regionDomain: string;
  workspace: string;
}

interface PlanPaymentInput extends BillingCredentials {
  operator: "downgraded" | "renewed" | "upgraded";
  planName: string;
  promotionCode?: string;
  regionDomain: string;
  workspace: string;
}

interface PlanWorkspaceInput extends BillingCredentials {
  regionDomain: string;
  workspace: string;
}

interface BillingPlanChangeServices {
  cancelInvoice: (
    input: PlanWorkspaceInput & { invoiceId: string }
  ) => Promise<void>;
  checkDowngrade: (
    input: PlanWorkspaceInput & {
      limits: NonNullable<BillingPlanSnapshot["plans"][number]["limits"]>;
    }
  ) => Promise<SubscriptionDowngradeCheck>;
  createPayment: (input: PlanPaymentInput) => Promise<SubscriptionPlanCheckout>;
  loadTransaction: (
    input: PlanWorkspaceInput
  ) => Promise<SubscriptionTransactionStatus | null>;
  loadUpgradeQuote: (
    input: UpgradeQuoteInput
  ) => Promise<SubscriptionUpgradeQuote>;
  openCheckoutUrl: (url: string) => void;
  openCheckoutWindow: () => CheckoutWindowHandle | null;
  redirectTop: (url: string) => void;
}

const DEFAULT_SERVICES: BillingPlanChangeServices = {
  cancelInvoice: cancelSubscriptionInvoice,
  checkDowngrade: checkSubscriptionDowngrade,
  createPayment: createSubscriptionPlanPayment,
  loadTransaction: loadSubscriptionTransactionStatus,
  loadUpgradeQuote: loadSubscriptionUpgradeQuote,
  openCheckoutUrl: (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },
  openCheckoutWindow: () => {
    const checkoutWindow = window.open("about:blank", "_blank");
    if (checkoutWindow == null) {
      return null;
    }
    checkoutWindow.opener = null;
    return {
      close: () => checkoutWindow.close(),
      navigate: (url) => checkoutWindow.location.replace(url),
    };
  },
  redirectTop: (url) => {
    window.parent.location.href = url;
  },
};

function scheduleBrowserPoll(callback: () => void, delay: number): () => void {
  const timer = window.setTimeout(callback, delay);
  return () => window.clearTimeout(timer);
}

interface BillingPlanChangeDialogProps {
  credentials: BillingCredentials;
  currency: BillingCurrency;
  now?: () => number;
  onManageCard?: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectedPlanChange?: (planId: string | null) => void;
  onSubscriptionChanged: () => Promise<void>;
  open: boolean;
  paymentTimeoutMs?: number;
  pollIntervalMs?: number;
  schedulePoll?: (callback: () => void, delay: number) => () => void;
  selectedPlanId: string | null;
  services?: BillingPlanChangeServices;
  snapshot: BillingPlanSnapshot;
}

type ChangeStage = "downgrade" | "quote" | "select" | "waiting";
type SnapshotPlan = BillingPlanSnapshot["plans"][number];

const STAGE_DIALOG_SIZES: Record<ChangeStage, "default" | "lg"> = {
  downgrade: "default",
  quote: "lg",
  select: "default",
  waiting: "default",
};

interface WaitingStageProps {
  error: string | null;
  onCancel: () => Promise<void>;
  onReopen: () => void;
  status: "cancelling" | "polling" | "timed-out";
}

function WaitingStage({
  error,
  onCancel,
  onReopen,
  status,
}: WaitingStageProps) {
  const timedOut = status === "timed-out";
  const cancelling = status === "cancelling";

  return (
    <>
      <AppDialog.Header>
        <AppDialog.Icon>
          <LoaderCircle aria-hidden className="animate-spin" />
        </AppDialog.Icon>
        <AppDialog.Title>
          {timedOut ? "Payment timed out" : "Waiting for payment"}
        </AppDialog.Title>
        <AppDialog.Description>
          {timedOut
            ? "Payment was not confirmed within 10 minutes. Reopen Stripe or cancel this invoice."
            : "Complete payment in the Stripe tab. This page will update automatically."}
        </AppDialog.Description>
      </AppDialog.Header>
      {error == null ? null : (
        <AppDialog.Body>
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        </AppDialog.Body>
      )}
      <AppDialog.Footer>
        <AppButton disabled={cancelling} onClick={onCancel} variant="quiet">
          {cancelling ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : null}
          {cancelling ? "Cancelling..." : "Cancel payment"}
        </AppButton>
        <AppButton disabled={cancelling} onClick={onReopen}>
          Reopen payment page
        </AppButton>
      </AppDialog.Footer>
    </>
  );
}

interface DowngradeStageProps {
  check: SubscriptionDowngradeCheck | null;
  error: string | null;
  onConfirm: () => Promise<void>;
  plan: SnapshotPlan;
  submitting: boolean;
}

function DowngradeStage({
  check,
  error,
  onConfirm,
  plan,
  submitting,
}: DowngradeStageProps) {
  return (
    <>
      <AppDialog.Header>
        <AppDialog.Icon className="text-blue-400">
          <CircleCheckBig aria-hidden strokeWidth={1.75} />
        </AppDialog.Icon>
        <AppDialog.Title>Downgrade to {plan.name}</AppDialog.Title>
        <AppDialog.Description className="sr-only">
          Current workspace usage must fit the target plan before the downgrade
          can proceed.
        </AppDialog.Description>
      </AppDialog.Header>

      <AppDialog.Body>
        {check == null && error == null ? (
          <div
            className="flex items-center gap-2 text-muted-foreground"
            role="status"
          >
            <LoaderCircle aria-hidden className="animate-spin" />
            Checking workspace usage...
          </div>
        ) : null}
        {check?.allowed === false ? (
          <Alert variant="destructive">
            <AlertTitle>Target plan quota is exceeded</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4">
                {check.exceededResources.map((resource) => (
                  <li key={resource.label}>
                    {resource.label}: {resource.used} used, {resource.limit}{" "}
                    available
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
        {check?.allowed ? (
          <p className="text-muted-foreground text-sm">
            You are now in the process of changing your subscription, and the
            change will{" "}
            <span className="font-medium text-blue-400">
              {"take effect on the following month's subscription date."}
            </span>
          </p>
        ) : null}
        {error == null ? null : (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </AppDialog.Body>

      <AppDialog.Footer>
        <AppDialog.Cancel disabled={submitting}>
          Keep current plan
        </AppDialog.Cancel>
        <AppDialog.Action
          className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover"
          disabled={check?.allowed !== true}
          loading={submitting}
          loadingLabel="Opening checkout..."
          onClick={onConfirm}
        >
          Confirm downgrade
        </AppDialog.Action>
      </AppDialog.Footer>
    </>
  );
}

interface QuoteStageProps {
  card: BillingPlanSnapshot["card"];
  currency: BillingCurrency;
  error: string | null;
  onApplyPromotion: () => Promise<void>;
  onBack: () => void;
  onConfirm: () => Promise<void>;
  onManageCard?: () => void;
  onPromotionCodeChange: (value: string) => void;
  plan: SnapshotPlan;
  promotionCode: string;
  promotionError: string | null;
  promotionPending: boolean;
  quote: SubscriptionUpgradeQuote | null;
  submitting: boolean;
}

function cardBrandLabel(brand: string): string {
  const trimmed = brand.trim();
  if (trimmed === "") {
    return "Card";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function cardExpiryLabel(
  card: NonNullable<BillingPlanSnapshot["card"]>
): string | null {
  if (card.expMonth == null || card.expYear == null) {
    return null;
  }
  const month = String(card.expMonth).padStart(2, "0");
  const year = String(card.expYear).slice(-2);
  return `${month}/${year}`;
}

function QuoteStage({
  card,
  currency,
  error,
  onApplyPromotion,
  onBack,
  onConfirm,
  onManageCard,
  onPromotionCodeChange,
  plan,
  promotionCode,
  promotionError,
  promotionPending,
  quote,
  submitting,
}: QuoteStageProps) {
  const promotionDisabled =
    promotionCode.trim() === "" || promotionPending || submitting;
  const expiry = card == null ? null : cardExpiryLabel(card);

  return (
    <>
      <AppDialog.Header>
        <AppDialog.Title>Change Plan</AppDialog.Title>
        <AppDialog.Description className="sr-only">
          Review the prorated amount before opening Stripe Checkout.
        </AppDialog.Description>
      </AppDialog.Header>

      <AppDialog.Body className="pb-4">
        <div className="flex flex-col overflow-hidden rounded-lg border border-border sm:flex-row">
          <div className="flex flex-1 flex-col gap-5 bg-gradient-to-r from-yellow-200/10 to-sky-300/10 p-6">
            <h3 className="font-semibold text-foreground">Order summary</h3>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <span className="font-semibold text-3xl text-foreground">
                {plan.name}
              </span>
              <p className="font-semibold text-lg tabular-nums">
                {formatBillingAmount(plan.priceMicroUnits, currency)}
                <span className="font-normal text-muted-foreground">
                  /month
                </span>
              </p>
            </div>
            {plan.resources.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {plan.resources.map((resource) => (
                  <li className="flex items-center gap-2" key={resource.label}>
                    <CircleCheck
                      aria-hidden
                      className="size-4 shrink-0 text-primary"
                      strokeWidth={1.75}
                    />
                    <span className="text-muted-foreground text-sm">
                      {resource.label}: {resource.value}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex items-end gap-2">
              <AppInputField
                className="min-w-0 flex-1"
                disabled={promotionPending || submitting}
                error={promotionError}
                id="billing-promotion-code"
                label="Promotion code"
                onChange={(event) =>
                  onPromotionCodeChange(event.currentTarget.value)
                }
                placeholder="Enter a code"
                value={promotionCode}
              />
              <AppButton
                disabled={promotionDisabled}
                onClick={onApplyPromotion}
                variant="secondary"
              >
                {promotionPending ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : null}
                {promotionPending ? "Applying..." : "Apply code"}
              </AppButton>
            </div>
            {quote?.hasDiscount ? (
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="flex items-center gap-2 text-primary">
                  <CircleCheck aria-hidden className="size-4" />
                  Code applied
                </span>
                <span className="text-destructive tabular-nums">
                  -{formatBillingAmount(quote.discountMicroUnits, currency)}
                </span>
              </div>
            ) : null}
            <Separator />
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">Total billed monthly</span>
              <span className="font-medium tabular-nums">
                {formatBillingAmount(plan.priceMicroUnits, currency)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium">Due today</span>
              <span className="font-semibold tabular-nums">
                {quote == null
                  ? "Calculating..."
                  : formatBillingAmount(quote.amountMicroUnits, currency)}
              </span>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between gap-6 border-border border-t p-6 sm:border-t-0 sm:border-l">
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold text-foreground">Payment method</h3>
              {card == null ? (
                <p className="text-muted-foreground text-sm">
                  Payment is completed in Stripe Checkout.
                </p>
              ) : (
                <div className="flex min-h-13 flex-wrap items-center gap-3 rounded-lg bg-input/30 px-3 py-2">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-input/40 text-muted-foreground">
                    <CreditCard
                      aria-hidden
                      className="size-5"
                      strokeWidth={1.75}
                    />
                  </div>
                  <span className="font-medium text-foreground text-sm">
                    {cardBrandLabel(card.brand)}
                  </span>
                  <span className="font-medium text-foreground text-sm">
                    •••• {card.last4}
                  </span>
                  {expiry == null ? null : (
                    <span className="text-muted-foreground text-xs">
                      EXP: {expiry}
                    </span>
                  )}
                </div>
              )}
              {card != null && onManageCard != null ? (
                <AppButton
                  className="h-auto self-start p-0 text-blue-400 hover:text-blue-400"
                  onClick={onManageCard}
                  variant="link"
                >
                  Manage Card Info
                  <ArrowUpRight aria-hidden data-icon="inline-end" />
                </AppButton>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              {error == null ? null : (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              )}
              <AppButton
                className="w-full"
                disabled={quote == null || submitting}
                onClick={onConfirm}
              >
                {submitting ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : null}
                {submitting ? "Opening checkout..." : "Subscribe & Pay"}
              </AppButton>
              <AppButton className="w-full" onClick={onBack} variant="quiet">
                Back
              </AppButton>
            </div>
          </div>
        </div>
      </AppDialog.Body>
    </>
  );
}

function PlanSelectionStage({
  currency,
  onSelect,
  plans,
}: {
  currency: BillingCurrency;
  onSelect: (planId: string) => void;
  plans: BillingPlanSnapshot["plans"];
}) {
  return (
    <>
      <AppDialog.Header>
        <AppDialog.Title>Change subscription plan</AppDialog.Title>
        <AppDialog.Description>
          Choose the plan that fits this workspace.
        </AppDialog.Description>
      </AppDialog.Header>
      <AppDialog.Body>
        <div className="flex flex-col gap-3">
          {plans.map((plan) => {
            const actionLabel =
              plan.changeKind === "upgrade"
                ? `Upgrade to ${plan.name}`
                : `Downgrade to ${plan.name}`;
            return (
              <div
                className="flex flex-col gap-4 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
                key={plan.id}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-foreground">{plan.name}</h3>
                    {plan.isCurrent ? (
                      <Badge variant="secondary">Current</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {plan.description}
                  </p>
                  <p className="mt-2 font-medium tabular-nums">
                    {formatBillingAmount(plan.priceMicroUnits, currency)}
                    <span className="font-normal text-muted-foreground">
                      /month
                    </span>
                  </p>
                </div>
                {plan.changeKind == null ? null : (
                  <AppButton
                    className="w-full sm:w-auto"
                    onClick={() => onSelect(plan.id)}
                    variant="secondary"
                  >
                    {plan.changeKind === "upgrade" ? (
                      <ArrowUpRight aria-hidden data-icon="inline-start" />
                    ) : (
                      <ArrowDownRight aria-hidden data-icon="inline-start" />
                    )}
                    {actionLabel}
                  </AppButton>
                )}
              </div>
            );
          })}
        </div>
      </AppDialog.Body>
      <AppDialog.Footer>
        <AppDialog.Cancel />
      </AppDialog.Footer>
    </>
  );
}

type PaymentPollResult =
  | { kind: "completed" }
  | { error: string | null; kind: "continue" }
  | { kind: "timed-out" };

async function pollUpgradePayment({
  checkoutPayId,
  credentials,
  elapsedMs,
  onSubscriptionChanged,
  paymentTimeoutMs,
  regionDomain,
  services,
  workspace,
}: {
  checkoutPayId: string | null | undefined;
  credentials: BillingCredentials;
  elapsedMs: number;
  onSubscriptionChanged: () => Promise<void>;
  paymentTimeoutMs: number;
  regionDomain: string;
  services: BillingPlanChangeServices;
  workspace: string;
}): Promise<PaymentPollResult> {
  if (elapsedMs >= paymentTimeoutMs) {
    return { kind: "timed-out" };
  }

  try {
    const transaction = await services.loadTransaction({
      ...credentials,
      regionDomain,
      workspace,
    });
    const matchesCheckout =
      checkoutPayId != null && transaction?.payId === checkoutPayId;
    if (transaction?.status === "completed" && matchesCheckout) {
      await onSubscriptionChanged();
      return { kind: "completed" };
    }
    return { error: null, kind: "continue" };
  } catch (cause) {
    return {
      error: errorDescription(
        cause,
        "Payment status could not be checked. Polling will continue."
      ),
      kind: "continue",
    };
  }
}

export function BillingPlanChangeDialog({
  credentials,
  currency,
  now = Date.now,
  onManageCard,
  onOpenChange,
  onSelectedPlanChange,
  onSubscriptionChanged,
  open,
  paymentTimeoutMs = 10 * 60 * 1000,
  pollIntervalMs = 3000,
  schedulePoll = scheduleBrowserPoll,
  selectedPlanId,
  services = DEFAULT_SERVICES,
  snapshot,
}: BillingPlanChangeDialogProps) {
  const { appToken, kubeconfig } = credentials;
  const selectedPlan = useMemo(
    () => snapshot.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [selectedPlanId, snapshot.plans]
  );
  const [stage, setStage] = useState<ChangeStage>(
    selectedPlan?.changeKind === "upgrade" ? "quote" : "select"
  );
  const [quote, setQuote] = useState<SubscriptionUpgradeQuote | null>(null);
  const [checkout, setCheckout] = useState<SubscriptionPlanCheckout | null>(
    null
  );
  const [downgradeCheck, setDowngradeCheck] =
    useState<SubscriptionDowngradeCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promotionCode, setPromotionCode] = useState("");
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [promotionPending, setPromotionPending] = useState(false);
  const [waitingStartedAt, setWaitingStartedAt] = useState<number | null>(null);
  const [waitingStatus, setWaitingStatus] = useState<
    "cancelling" | "polling" | "timed-out"
  >("polling");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setCheckout(null);
      setDowngradeCheck(null);
      setError(null);
      setPromotionCode("");
      setPromotionError(null);
      setPromotionPending(false);
      setQuote(null);
      setStage("select");
      setSubmitting(false);
      setWaitingStartedAt(null);
      setWaitingStatus("polling");
      return;
    }
    if (selectedPlan?.changeKind === "downgrade") {
      let active = true;
      setDowngradeCheck(null);
      setError(null);
      setStage("downgrade");
      services
        .checkDowngrade({
          appToken,
          kubeconfig,
          limits: selectedPlan.limits ?? {},
          regionDomain: snapshot.current.regionDomain,
          workspace: snapshot.current.workspace,
        })
        .then((nextCheck) => {
          if (active) {
            setDowngradeCheck(nextCheck);
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setError(
              errorDescription(
                cause,
                "Workspace usage could not be checked for downgrade."
              )
            );
          }
        });
      return () => {
        active = false;
      };
    }
    if (selectedPlan?.changeKind !== "upgrade") {
      setStage("select");
      return;
    }

    let active = true;
    setError(null);
    setPromotionError(null);
    setQuote(null);
    setStage("quote");
    services
      .loadUpgradeQuote({
        appToken,
        kubeconfig,
        planName: selectedPlan.name,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      })
      .then((nextQuote) => {
        if (active) {
          setQuote(nextQuote);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            errorDescription(
              cause,
              "The prorated upgrade amount could not be calculated."
            )
          );
        }
      });
    return () => {
      active = false;
    };
  }, [
    appToken,
    kubeconfig,
    open,
    selectedPlan,
    services,
    snapshot.current.regionDomain,
    snapshot.current.workspace,
  ]);

  const confirmUpgrade = async () => {
    if (selectedPlan == null || quote == null || submitting) {
      return;
    }

    const checkoutWindow = services.openCheckoutWindow();
    setError(null);
    setSubmitting(true);
    try {
      const nextCheckout = await services.createPayment({
        appToken,
        kubeconfig,
        operator: "upgraded",
        planName: selectedPlan.name,
        promotionCode: quote.promotionCode || undefined,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      });
      if (nextCheckout.redirectUrl == null) {
        checkoutWindow?.close();
        throw new Error("The billing service did not return a payment URL.");
      }
      checkoutWindow?.navigate(nextCheckout.redirectUrl);
      setCheckout(nextCheckout);
      setWaitingStartedAt(now());
      setWaitingStatus("polling");
      setStage("waiting");
    } catch (cause) {
      checkoutWindow?.close();
      setError(
        errorDescription(
          cause,
          "The subscription payment could not be created."
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  const applyPromotionCode = async () => {
    const code = promotionCode.trim();
    if (
      selectedPlan == null ||
      selectedPlan.changeKind !== "upgrade" ||
      code === "" ||
      promotionPending
    ) {
      return;
    }

    setPromotionError(null);
    setPromotionPending(true);
    try {
      const nextQuote = await services.loadUpgradeQuote({
        appToken,
        kubeconfig,
        planName: selectedPlan.name,
        promotionCode: code,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      });
      setQuote(nextQuote);
      setPromotionCode(nextQuote.promotionCode || code);
    } catch (cause) {
      setPromotionError(
        cause instanceof SubscriptionPromotionCodeError
          ? cause.message
          : errorDescription(cause, "The promotion code could not be applied.")
      );
    } finally {
      setPromotionPending(false);
    }
  };

  const confirmDowngrade = async () => {
    if (
      selectedPlan == null ||
      downgradeCheck?.allowed !== true ||
      submitting
    ) {
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const nextCheckout = await services.createPayment({
        appToken,
        kubeconfig,
        operator: "downgraded",
        planName: selectedPlan.name,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      });
      if (nextCheckout.redirectUrl != null) {
        services.redirectTop(nextCheckout.redirectUrl);
        return;
      }
      if (!nextCheckout.success) {
        throw new Error("The billing service did not accept the downgrade.");
      }
      await onSubscriptionChanged();
      onOpenChange(false);
    } catch (cause) {
      setError(
        errorDescription(cause, "The subscription could not be downgraded.")
      );
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (
      stage !== "waiting" ||
      waitingStartedAt == null ||
      waitingStatus !== "polling"
    ) {
      return;
    }

    let active = true;
    let cancelScheduledPoll: (() => void) | undefined;
    const poll = async () => {
      if (!active) {
        return;
      }

      const result = await pollUpgradePayment({
        checkoutPayId: checkout?.payId,
        credentials: { appToken, kubeconfig },
        elapsedMs: now() - waitingStartedAt,
        onSubscriptionChanged,
        paymentTimeoutMs,
        regionDomain: snapshot.current.regionDomain,
        services,
        workspace: snapshot.current.workspace,
      });
      if (!active) {
        return;
      }
      if (result.kind === "timed-out") {
        setWaitingStatus("timed-out");
        return;
      }
      if (result.kind === "completed") {
        onOpenChange(false);
        return;
      }
      if (result.error != null) {
        setError(result.error);
      }
      cancelScheduledPoll = schedulePoll(() => {
        poll().catch(() => undefined);
      }, pollIntervalMs);
    };

    poll().catch(() => undefined);
    return () => {
      active = false;
      cancelScheduledPoll?.();
    };
  }, [
    appToken,
    checkout?.payId,
    kubeconfig,
    now,
    onOpenChange,
    onSubscriptionChanged,
    paymentTimeoutMs,
    pollIntervalMs,
    schedulePoll,
    services,
    snapshot.current.regionDomain,
    snapshot.current.workspace,
    stage,
    waitingStartedAt,
    waitingStatus,
  ]);

  const cancelWaitingPayment = async () => {
    if (waitingStatus === "cancelling") {
      return;
    }

    setError(null);
    setWaitingStatus("cancelling");
    try {
      if (checkout?.invoiceId != null) {
        await services.cancelInvoice({
          appToken,
          invoiceId: checkout.invoiceId,
          kubeconfig,
          regionDomain: snapshot.current.regionDomain,
          workspace: snapshot.current.workspace,
        });
      }
      await onSubscriptionChanged();
      onOpenChange(false);
    } catch (cause) {
      setError(
        errorDescription(
          cause,
          "The unpaid upgrade invoice could not be cancelled."
        )
      );
      setWaitingStatus("timed-out");
    }
  };

  let content = (
    <PlanSelectionStage
      currency={currency}
      onSelect={(planId) => onSelectedPlanChange?.(planId)}
      plans={snapshot.plans}
    />
  );
  if (stage === "waiting") {
    content = (
      <WaitingStage
        error={error}
        onCancel={cancelWaitingPayment}
        onReopen={() => {
          if (checkout?.redirectUrl != null) {
            services.openCheckoutUrl(checkout.redirectUrl);
          }
        }}
        status={waitingStatus}
      />
    );
  } else if (stage === "downgrade" && selectedPlan != null) {
    content = (
      <DowngradeStage
        check={downgradeCheck}
        error={error}
        onConfirm={confirmDowngrade}
        plan={selectedPlan}
        submitting={submitting}
      />
    );
  } else if (stage === "quote" && selectedPlan != null) {
    content = (
      <QuoteStage
        card={snapshot.card}
        currency={currency}
        error={error}
        onApplyPromotion={applyPromotionCode}
        onBack={() => {
          if (onSelectedPlanChange == null) {
            onOpenChange(false);
            return;
          }
          onSelectedPlanChange(null);
        }}
        onConfirm={confirmUpgrade}
        onManageCard={onManageCard}
        onPromotionCodeChange={(value) => {
          setPromotionCode(value);
          setPromotionError(null);
        }}
        plan={selectedPlan}
        promotionCode={promotionCode}
        promotionError={promotionError}
        promotionPending={promotionPending}
        quote={quote}
        submitting={submitting}
      />
    );
  }

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (stage !== "waiting" || nextOpen) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <AppDialog.Content size={STAGE_DIALOG_SIZES[stage]}>
        {content}
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export type {
  BillingPlanChangeDialogProps,
  BillingPlanChangeServices,
  CheckoutWindowHandle,
};
