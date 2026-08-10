"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import {
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { DialogClose } from "@workspace/ui/components/dialog";
import { Separator } from "@workspace/ui/components/separator";
import {
  ArrowUpRight,
  CircleCheck,
  CircleCheckBig,
  CreditCard,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import {
  BillingPlanCard,
  type BillingPlanCardState,
  PlanCheckGradientDefs,
  planCardAction,
} from "@/features/billing/billing-plan-card";
import type { NormalizedBillingPlan } from "@/features/billing/billing-plan-catalog";
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
  operator?: "created" | "upgraded";
  planName: string;
  promotionCode?: string;
  regionDomain: string;
  workspace: string;
}

interface PlanPaymentInput extends BillingCredentials {
  operator: "created" | "downgraded" | "renewed" | "upgraded";
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
type PlanChangeOperator = "created" | "downgraded" | "upgraded";

// The legacy costcenter operator decision: debt always re-creates the
// subscription (Renew), PAYG subscribes fresh, and the transition lists label
// upgrades/downgrades. `null` means the plan is not actionable (the current
// plan outside debt, or an Enterprise plan that routes to sales).
function planOperator(
  plan: SnapshotPlan | null,
  inDebt: boolean
): PlanChangeOperator | null {
  if (plan == null) {
    return null;
  }
  if (inDebt) {
    return "created";
  }
  switch (plan.changeKind) {
    case "downgrade":
      return "downgraded";
    case "subscribe":
      return "created";
    case "upgrade":
      return "upgraded";
    default:
      return null;
  }
}

const STAGE_DIALOG_SIZES: Record<ChangeStage, "2xl" | "default" | "lg"> = {
  downgrade: "default",
  quote: "lg",
  select: "2xl",
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
              <p className="mt-2">
                Reduce usage below the {plan.name} limits before the downgrade
                takes effect to avoid extra charges.
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        {check == null ? null : (
          <p className="text-muted-foreground text-sm">
            You are now in the process of changing your subscription, and the
            change will{" "}
            <span className="font-medium text-blue-400">
              {"take effect on the following month's subscription date."}
            </span>
          </p>
        )}
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

// The select stage renders catalog plans through the shared pricing-card
// surface, which expects the pricing loader's plan shape.
function selectionCardPlan(plan: SnapshotPlan): NormalizedBillingPlan {
  return {
    description: plan.description,
    id: plan.id,
    limits: plan.limits,
    monthlyOriginalPriceMicroUnits: plan.originalPriceMicroUnits ?? 0,
    monthlyPriceMicroUnits: plan.priceMicroUnits,
    name: plan.name,
    order: plan.order,
    primaryPriceMicroUnits: plan.priceMicroUnits,
    resources: plan.resources.map(({ label, type, value }) => ({
      label,
      type: type ?? "other",
      value,
    })),
    tags: plan.tags ?? [],
  };
}

function planSpecSummary(plan: SnapshotPlan): string {
  return plan.resources
    .map((resource) => `${resource.value} ${resource.label}`)
    .join(" + ");
}

const HTTP_URL_PATTERN = /^https?:\/\//i;

// Legacy costcenter treats Customized as a sales pointer, not a purchasable
// plan: its Description carries the contact URL.
function isContactJumpPlan(plan: SnapshotPlan): boolean {
  return plan.name.trim().toLowerCase() === "customized";
}

function planContactUrl(plan: SnapshotPlan): string | null {
  const raw = plan.description.trim();
  if (!HTTP_URL_PATTERN.test(raw)) {
    return null;
  }
  return URL.canParse(raw) ? raw : null;
}

function morePlanStatusBadge(
  plan: SnapshotPlan,
  pendingDowngradePlanName: string | null
) {
  if (plan.isCurrent) {
    return (
      <span className="shrink-0 rounded-full bg-blue-400/10 px-2 py-0.5 text-blue-400 text-xs">
        Your current plan
      </span>
    );
  }
  if (pendingDowngradePlanName === plan.name) {
    return (
      <span className="shrink-0 rounded-full bg-yellow-400/10 px-2 py-0.5 text-xs text-yellow-400">
        Your next plan
      </span>
    );
  }
  return null;
}

function MorePlanSeparator() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />;
}

function morePlanOption({
  currency,
  pendingDowngradePlanName,
  plan,
}: {
  currency: BillingCurrency;
  pendingDowngradePlanName: string | null;
  plan: SnapshotPlan;
}): AppSelectOption {
  if (isContactJumpPlan(plan)) {
    return {
      disabled: planContactUrl(plan) == null,
      label: (
        <span className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 font-medium">{plan.name}</span>
          <MorePlanSeparator />
          <span className="shrink-0 text-muted-foreground text-xs">
            Contact us
          </span>
        </span>
      ),
      textValue: `${plan.name} Contact us`,
      value: plan.id,
    };
  }
  const spec = planSpecSummary(plan);
  const price = `${formatBillingAmount(plan.priceMicroUnits, currency)}/month`;
  return {
    label: (
      <span className="flex min-w-0 items-center gap-3">
        <span className="shrink-0 font-medium">{plan.name}</span>
        <MorePlanSeparator />
        <span
          className="min-w-0 truncate text-muted-foreground text-xs"
          title={spec}
        >
          {spec}
        </span>
        <MorePlanSeparator />
        <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {price}
        </span>
        {morePlanStatusBadge(plan, pendingDowngradePlanName)}
      </span>
    ),
    textValue: `${plan.name} ${spec} ${price}`,
    value: plan.id,
  };
}

function PlanSelectionStage({
  currency,
  inDebt,
  onOpenUrl,
  onSelect,
  pendingDowngradePlanName,
  plans,
}: {
  currency: BillingCurrency;
  inDebt: boolean;
  onOpenUrl: (url: string) => void;
  onSelect: (planId: string) => void;
  pendingDowngradePlanName: string | null;
  plans: BillingPlanSnapshot["plans"];
}) {
  // The legacy costcenter split: plans without the "more" tag are the card
  // row (Free stays uncardable), "more" plans live in the selector row —
  // Customized included.
  const cardPlans = plans
    .filter(
      (plan) =>
        !(plan.tags ?? []).includes("more") &&
        plan.name.trim().toLowerCase() !== "free"
    )
    .slice()
    .sort((left, right) => left.order - right.order);
  const morePlans = plans
    .filter((plan) => (plan.tags ?? []).includes("more"))
    .slice()
    .sort((left, right) => left.order - right.order);
  // Mirrors the legacy default: the current plan when it lives in this
  // bucket, otherwise the first selectable (non-contact) entry.
  const [morePlanId, setMorePlanId] = useState(
    () =>
      (
        morePlans.find((plan) => plan.isCurrent) ??
        morePlans.find((plan) => !isContactJumpPlan(plan))
      )?.id ?? null
  );
  const selectedMorePlan =
    morePlans.find((plan) => plan.id === morePlanId) ?? null;

  const planStates = new Map<string, BillingPlanCardState>(
    plans.map((plan) => [
      plan.id,
      {
        changeKind: plan.changeKind ?? null,
        inDebt,
        isCurrent: plan.isCurrent,
        isPendingDowngradeTarget: pendingDowngradePlanName === plan.name,
      },
    ])
  );
  const standardIndex = cardPlans.findIndex(
    (plan) => plan.name.trim().toUpperCase() === "STANDARD"
  );
  const mostPopularIndex = standardIndex === -1 ? 1 : standardIndex;

  return (
    <>
      <div className="flex shrink-0 items-center gap-4 px-8 pt-7">
        <AppDialog.Title className="h-auto font-semibold text-2xl/8">
          Choose Your Workspace Plan
        </AppDialog.Title>
        <AppDialog.Description className="sr-only">
          Choose the plan that fits this workspace.
        </AppDialog.Description>
        <DialogClose
          aria-label="Close"
          className="-m-2 shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:ring-[1px] focus-visible:ring-blue-400/50"
        >
          <X aria-hidden className="size-5" />
        </DialogClose>
      </div>
      <AppDialog.Body className="px-8 pt-6 pb-8">
        <PlanCheckGradientDefs />
        <div className="flex flex-col gap-3 lg:flex-row">
          {cardPlans.map((plan, index) => (
            <BillingPlanCard
              action={planCardAction({
                onSelectPlan: onSelect,
                plan: selectionCardPlan(plan),
                planStates,
                planStatesPending: false,
              })}
              currency={currency}
              gpuEnabled
              key={plan.id}
              mostPopular={index === mostPopularIndex}
              plan={selectionCardPlan(plan)}
            />
          ))}
        </div>

        {morePlans.length === 0 ? null : (
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <AppSelect
              aria-label="More plans"
              className="h-10 min-w-0 lg:flex-1"
              onValueChange={(value) => {
                const plan = morePlans.find((entry) => entry.id === value);
                if (plan == null) {
                  return;
                }
                if (isContactJumpPlan(plan)) {
                  const contactUrl = planContactUrl(plan);
                  if (contactUrl != null) {
                    onOpenUrl(contactUrl);
                  }
                  return;
                }
                setMorePlanId(plan.id);
              }}
              options={morePlans.map((plan) =>
                morePlanOption({ currency, pendingDowngradePlanName, plan })
              )}
              placeholder="Select a plan"
              value={selectedMorePlan?.id}
            />
            {selectedMorePlan == null
              ? null
              : planCardAction({
                  className: "w-full shrink-0 lg:w-auto",
                  onSelectPlan: onSelect,
                  plan: selectionCardPlan(selectedMorePlan),
                  planStates,
                  planStatesPending: false,
                })}
          </div>
        )}
      </AppDialog.Body>
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
  const inDebt = snapshot.current.lifecycle === "payment-due";
  const selectedOperator = planOperator(selectedPlan, inDebt);
  const [stage, setStage] = useState<ChangeStage>(
    selectedOperator === "created" || selectedOperator === "upgraded"
      ? "quote"
      : "select"
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
    const operator = planOperator(selectedPlan, inDebt);
    if (selectedPlan != null && operator === "downgraded") {
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
    if (
      selectedPlan == null ||
      (operator !== "created" && operator !== "upgraded")
    ) {
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
        operator,
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
    inDebt,
    kubeconfig,
    open,
    selectedPlan,
    services,
    snapshot.current.regionDomain,
    snapshot.current.workspace,
  ]);

  const confirmUpgrade = async () => {
    if (
      selectedPlan == null ||
      quote == null ||
      submitting ||
      (selectedOperator !== "created" && selectedOperator !== "upgraded")
    ) {
      return;
    }

    const checkoutWindow = services.openCheckoutWindow();
    setError(null);
    setSubmitting(true);
    try {
      const nextCheckout = await services.createPayment({
        appToken,
        kubeconfig,
        operator: selectedOperator,
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
      (selectedOperator !== "created" && selectedOperator !== "upgraded") ||
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
        operator: selectedOperator,
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

  // Mirrors the legacy costcenter: an exceeded quota warns but never blocks —
  // the downgrade lands at period end and the user gets the rest of the cycle
  // to shrink usage.
  const confirmDowngrade = async () => {
    if (selectedPlan == null || submitting) {
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
      inDebt={inDebt}
      onOpenUrl={services.openCheckoutUrl}
      onSelect={(planId) => onSelectedPlanChange?.(planId)}
      pendingDowngradePlanName={snapshot.pendingDowngrade?.planName ?? null}
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
