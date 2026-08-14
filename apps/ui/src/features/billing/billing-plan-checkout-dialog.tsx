"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { DialogClose } from "@workspace/ui/components/dialog";
import { Separator } from "@workspace/ui/components/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangle,
  ArrowUpRight,
  CircleCheck,
  CircleCheckBig,
  CircleHelp,
  CreditCard,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import {
  PLAN_CHECK_STROKE,
  PlanCheckGradientDefs,
  planCardRecipe,
  planFeatures,
} from "@/features/billing/billing-plan-card";
import {
  type BillingPlanSnapshot,
  cancelSubscriptionInvoice,
  checkSubscriptionDowngrade,
  createSubscriptionPlanPayment,
  loadSubscriptionTransactionStatus,
  loadSubscriptionUpgradeQuote,
  type PendingSubscriptionUpgrade,
  type SubscriptionDowngradeCheck,
  type SubscriptionPlanCheckout,
  SubscriptionPromotionCodeError,
  type SubscriptionTransactionStatus,
  type SubscriptionUpgradeQuote,
  type SubscriptionUpgradeQuoteResult,
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
  ) => Promise<SubscriptionUpgradeQuoteResult>;
  openCheckoutUrl: (url: string) => void;
  openCheckoutWindow: () => CheckoutWindowHandle | null;
  redirectTop: (url: string) => void;
}

const DEFAULT_PLAN_CHANGE_SERVICES: BillingPlanChangeServices = {
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

type CheckoutStage = "downgrade" | "quote" | "recovery" | "waiting";
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

// When the checkout stacks over the plan picker's dialog, the root backdrop
// already dims the page and the receded picker, so the nested overlay stays
// fully transparent — stage changes (quote → waiting) then never pulse the
// scrim.
const NESTED_DIALOG_OVERLAY =
  "bg-transparent backdrop-blur-none supports-backdrop-filter:backdrop-blur-none";

interface WaitingStageProps {
  error: string | null;
  onCancel: () => Promise<void>;
  onReopen: () => void;
  status: "cancelling" | "failed" | "polling" | "timed-out";
}

function WaitingStage({
  error,
  onCancel,
  onReopen,
  status,
}: WaitingStageProps) {
  const timedOut = status === "timed-out";
  const failed = status === "failed";
  const cancelling = status === "cancelling";
  let description =
    "Complete payment in the Stripe tab. This page will update automatically.";
  let title = "Waiting for payment";
  if (failed) {
    description =
      "Stripe reported that this payment did not complete. Reopen the payment page or cancel this invoice.";
    title = "Payment failed";
  } else if (timedOut) {
    description =
      "Payment was not confirmed within 10 minutes. Reopen Stripe or cancel this invoice.";
    title = "Payment timed out";
  }

  return (
    <>
      <AppDialog.Header>
        <AppDialog.Icon>
          {failed ? (
            <AlertTriangle aria-hidden />
          ) : (
            <LoaderCircle aria-hidden className="animate-spin" />
          )}
        </AppDialog.Icon>
        <AppDialog.Title>{title}</AppDialog.Title>
        <AppDialog.Description>{description}</AppDialog.Description>
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

interface RecoveryStageProps {
  cancelling: boolean;
  error: string | null;
  onCancel: () => Promise<void>;
  onContinue: () => void;
  pendingUpgrade: PendingSubscriptionUpgrade;
}

function RecoveryStage({
  cancelling,
  error,
  onCancel,
  onContinue,
  pendingUpgrade,
}: RecoveryStageProps) {
  return (
    <>
      <AppDialog.Header>
        <AppDialog.Icon>
          <AlertTriangle aria-hidden />
        </AppDialog.Icon>
        <AppDialog.Title>Payment already in progress</AppDialog.Title>
        <AppDialog.Description>
          Complete the existing payment or cancel it before starting another
          checkout.
        </AppDialog.Description>
      </AppDialog.Header>
      <AppDialog.Body className="pt-0">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Pending plan</dt>
          <dd className="min-w-0 truncate text-right font-medium text-foreground">
            {pendingUpgrade.planName}
          </dd>
        </dl>
        {error == null ? null : (
          <p className="mt-4 text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </AppDialog.Body>
      <AppDialog.Footer>
        <AppButton disabled={cancelling} onClick={onCancel} variant="quiet">
          {cancelling ? (
            <LoaderCircle aria-hidden className="animate-spin" />
          ) : null}
          {cancelling ? "Cancelling..." : "Cancel and choose another plan"}
        </AppButton>
        <AppButton disabled={cancelling} onClick={onContinue}>
          Continue payment
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
  gpuEnabled: boolean;
  onApplyPromotion: () => Promise<void>;
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

interface PromotionCodeFieldProps {
  code: string;
  currency: BillingCurrency;
  error: string | null;
  onApply: () => Promise<void>;
  onCodeChange: (value: string) => void;
  pending: boolean;
  quote: SubscriptionUpgradeQuote | null;
  submitting: boolean;
}

// The design keeps the promo field out of sight until asked for (and drops
// it once a code is applied) — business users still get the full input.
function PromotionCodeField({
  code,
  currency,
  error,
  onApply,
  onCodeChange,
  pending,
  quote,
  submitting,
}: PromotionCodeFieldProps) {
  const [open, setOpen] = useState(() => code.trim() !== "");

  if (quote?.hasDiscount) {
    return (
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="flex min-w-0 items-center gap-2 text-primary">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          <span className="truncate">
            Code applied
            {quote.promotionCode === "" ? "" : ` · ${quote.promotionCode}`}
          </span>
        </span>
        <span className="shrink-0 text-destructive tabular-nums">
          -{formatBillingAmount(quote.discountMicroUnits, currency)}
        </span>
      </div>
    );
  }
  if (!open) {
    return (
      <AppButton
        className="h-auto self-start p-0 text-blue-400 hover:text-blue-400"
        onClick={() => setOpen(true)}
        variant="link"
      >
        Have a promo code?
      </AppButton>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <AppInputField
        className="min-w-0 flex-1"
        disabled={pending || submitting}
        error={error}
        id="billing-promotion-code"
        label="Promotion code"
        onChange={(event) => onCodeChange(event.currentTarget.value)}
        placeholder="Enter a code"
        value={code}
      />
      <AppButton
        disabled={code.trim() === "" || pending || submitting}
        onClick={onApply}
        variant="secondary"
      >
        {pending ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
        {pending ? "Applying..." : "Apply code"}
      </AppButton>
    </div>
  );
}

function PaymentMethodCard({
  card,
}: {
  card: NonNullable<BillingPlanSnapshot["card"]>;
}) {
  const expiry = cardExpiryLabel(card);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-input/30 p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="flex h-9 w-13 shrink-0 items-center justify-center rounded-sm bg-white">
          <CreditCard
            aria-hidden
            className="size-5 text-zinc-700"
            strokeWidth={1.75}
          />
        </span>
        <span className="font-medium text-foreground text-sm">
          {cardBrandLabel(card.brand)}
        </span>
        <span className="font-medium text-foreground text-sm">
          •••• {card.last4}
        </span>
        {expiry == null ? null : (
          <span className="text-muted-foreground text-xs">EXP: {expiry}</span>
        )}
      </div>
      <span className="shrink-0 rounded-full bg-blue-400 px-2 py-1 font-medium text-xs text-zinc-950">
        Default
      </span>
    </div>
  );
}

function QuoteStage({
  card,
  currency,
  error,
  gpuEnabled,
  onApplyPromotion,
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
  const recipe = planCardRecipe(plan.name);
  const features = planFeatures(plan.name);
  const originalPrice = plan.originalPriceMicroUnits ?? 0;
  const specs = [
    ...plan.resources
      .filter((resource) => gpuEnabled || resource.type !== "gpu")
      .map((resource) => `${resource.value} ${resource.label}`),
    ...features,
  ];

  return (
    <>
      <div className="flex shrink-0 items-center gap-4 px-6 pt-6">
        <AppDialog.Title className="h-auto min-w-0 flex-1 font-semibold text-lg/7">
          Change Plan
        </AppDialog.Title>
        <AppDialog.Description className="sr-only">
          Review the prorated amount before opening Stripe Checkout.
        </AppDialog.Description>
        <DialogClose
          aria-label="Close"
          className="-m-2 shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:ring-[1px] focus-visible:ring-blue-400/50"
        >
          <X aria-hidden className="size-4" />
        </DialogClose>
      </div>

      <AppDialog.Body className="px-6 pt-4 pb-6">
        <PlanCheckGradientDefs />
        <div className="flex flex-col overflow-hidden rounded-lg border border-border sm:flex-row">
          <div
            className={cn(
              "flex flex-col gap-6 p-6 sm:w-[400px] sm:shrink-0",
              recipe == null ? "bg-input/30" : cn("bg-linear-to-r", recipe.wash)
            )}
          >
            <h3 className="font-semibold text-base text-foreground leading-none">
              Order summary
            </h3>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <span
                  className={cn(
                    "font-semibold text-3xl/9",
                    recipe == null ? "text-foreground" : recipe.text
                  )}
                >
                  {plan.name}
                </span>
                <p className="flex items-end gap-0.5 tabular-nums">
                  {originalPrice > 0 &&
                  originalPrice !== plan.priceMicroUnits ? (
                    <span className="font-semibold text-foreground/50 text-lg/7 line-through">
                      {formatBillingAmount(originalPrice, currency)}
                    </span>
                  ) : null}
                  <span className="font-semibold text-foreground text-lg/7">
                    {formatBillingAmount(plan.priceMicroUnits, currency)}
                  </span>
                  <span className="text-base text-muted-foreground">
                    /month
                  </span>
                </p>
              </div>
              {specs.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {specs.map((spec) => (
                    <li className="flex items-center gap-2" key={spec}>
                      <CircleCheck
                        aria-hidden
                        className={cn("size-4 shrink-0", PLAN_CHECK_STROKE)}
                        strokeWidth={1.75}
                      />
                      <span className="text-muted-foreground text-sm">
                        {spec}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <PromotionCodeField
                code={promotionCode}
                currency={currency}
                error={promotionError}
                onApply={onApplyPromotion}
                onCodeChange={onPromotionCodeChange}
                pending={promotionPending}
                quote={quote}
                submitting={submitting}
              />
              <Separator />
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-foreground">
                  Total billed monthly
                </span>
                <span className="font-medium tabular-nums">
                  {formatBillingAmount(plan.priceMicroUnits, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 text-sm">
                <span className="flex items-center gap-2 font-medium text-foreground">
                  Due today
                  <Tooltip>
                    {/* An explicit help affordance — open near-instantly
                        instead of the provider's hover-intent delay. */}
                    <TooltipTrigger
                      aria-label="About the amount due today"
                      className="cursor-help rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[1px] focus-visible:ring-blue-400/50"
                      delay={100}
                      type="button"
                    >
                      <CircleHelp
                        aria-hidden
                        className="size-4"
                        strokeWidth={1.75}
                      />
                    </TooltipTrigger>
                    <TooltipContent
                      className="dark"
                      positionerClassName="z-[52]"
                    >
                      Prorated charge for the remainder of the current billing
                      cycle.
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="font-semibold tabular-nums">
                  {quote == null
                    ? "Calculating..."
                    : formatBillingAmount(quote.amountMicroUnits, currency)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between gap-6 border-border border-t p-6 sm:border-t-0 sm:border-l">
            <div className="flex flex-col gap-3">
              <h3 className="font-semibold text-base text-foreground leading-none">
                Payment method
              </h3>
              {card == null ? (
                <p className="text-muted-foreground text-sm">
                  Payment is completed in Stripe Checkout.
                </p>
              ) : (
                <PaymentMethodCard card={card} />
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
            </div>
          </div>
        </div>
      </AppDialog.Body>
    </>
  );
}

type PaymentPollResult =
  | { kind: "completed" }
  | { error: string | null; kind: "continue" }
  | { kind: "failed" }
  | { kind: "timed-out" };

async function checkUpgradePayment({
  checkoutPayId,
  credentials,
  onSubscriptionChanged,
  regionDomain,
  services,
  workspace,
}: {
  checkoutPayId: string | null | undefined;
  credentials: BillingCredentials;
  onSubscriptionChanged: () => Promise<void>;
  regionDomain: string;
  services: BillingPlanChangeServices;
  workspace: string;
}): Promise<Exclude<PaymentPollResult, { kind: "timed-out" }>> {
  try {
    const transaction = await services.loadTransaction({
      ...credentials,
      regionDomain,
      workspace,
    });
    const matchesCheckout =
      checkoutPayId != null && transaction?.payId === checkoutPayId;
    if (!matchesCheckout) {
      return { error: null, kind: "continue" };
    }

    const status = transaction.status.trim().toLowerCase();
    if (status === "completed") {
      await onSubscriptionChanged();
      return { kind: "completed" };
    }
    if (
      status === "failed" ||
      status === "cancelled" ||
      status === "canceled"
    ) {
      return { kind: "failed" };
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

function pollUpgradePayment({
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
    return Promise.resolve({ kind: "timed-out" });
  }

  return checkUpgradePayment({
    checkoutPayId,
    credentials,
    onSubscriptionChanged,
    regionDomain,
    services,
    workspace,
  });
}

interface BillingPlanCheckoutDialogProps {
  credentials: BillingCredentials;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  /**
   * Stacked over the plan picker's dialog: the nested overlay stays
   * transparent so the root backdrop never doubles up.
   */
  nested?: boolean;
  now?: () => number;
  /** The flow finished (payment confirmed, downgrade applied, or a waiting
   *  payment cancelled) — close the whole plan-change surface. */
  onClose: () => void;
  /** The user backed out of the stage (Esc, outside press, close button). */
  onDismiss: () => void;
  onManageCard?: () => void;
  onSubscriptionChanged: () => Promise<void>;
  open: boolean;
  paymentTimeoutMs?: number;
  plan: SnapshotPlan | null;
  pollIntervalMs?: number;
  schedulePoll?: (callback: () => void, delay: number) => () => void;
  services?: BillingPlanChangeServices;
  snapshot: BillingPlanSnapshot;
}

export function BillingPlanCheckoutDialog({
  credentials,
  currency,
  gpuEnabled,
  nested = false,
  now = Date.now,
  onClose,
  onDismiss,
  onManageCard,
  onSubscriptionChanged,
  open,
  paymentTimeoutMs = 10 * 60 * 1000,
  plan,
  pollIntervalMs = 3000,
  schedulePoll = scheduleBrowserPoll,
  services = DEFAULT_PLAN_CHANGE_SERVICES,
  snapshot,
}: BillingPlanCheckoutDialogProps) {
  const { appToken, kubeconfig } = credentials;
  const inDebt = snapshot.current.lifecycle === "payment-due";
  const operator = planOperator(plan, inDebt);
  const [stage, setStage] = useState<CheckoutStage>(
    operator === "downgraded" ? "downgrade" : "quote"
  );
  const [quote, setQuote] = useState<SubscriptionUpgradeQuote | null>(null);
  const [pendingUpgrade, setPendingUpgrade] =
    useState<PendingSubscriptionUpgrade | null>(null);
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
    "cancelling" | "failed" | "polling" | "timed-out"
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
      setPendingUpgrade(null);
      setQuote(null);
      setStage("quote");
      setSubmitting(false);
      setWaitingStartedAt(null);
      setWaitingStatus("polling");
      return;
    }
    const nextOperator = planOperator(plan, inDebt);
    if (plan != null && nextOperator === "downgraded") {
      let active = true;
      setDowngradeCheck(null);
      setError(null);
      setStage("downgrade");
      services
        .checkDowngrade({
          appToken,
          kubeconfig,
          limits: plan.limits ?? {},
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
      plan == null ||
      (nextOperator !== "created" && nextOperator !== "upgraded")
    ) {
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
        operator: nextOperator,
        planName: plan.name,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      })
      .then((result) => {
        if (!active) {
          return;
        }
        if (result.kind === "pending-upgrade") {
          setPendingUpgrade(result.pendingUpgrade);
          setStage("recovery");
        } else {
          setPendingUpgrade(null);
          setQuote(result.quote);
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
    plan,
    services,
    snapshot.current.regionDomain,
    snapshot.current.workspace,
  ]);

  const confirmUpgrade = async () => {
    if (
      plan == null ||
      quote == null ||
      submitting ||
      (operator !== "created" && operator !== "upgraded")
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
        operator,
        planName: plan.name,
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
      plan == null ||
      (operator !== "created" && operator !== "upgraded") ||
      code === "" ||
      promotionPending
    ) {
      return;
    }

    setPromotionError(null);
    setPromotionPending(true);
    try {
      const result = await services.loadUpgradeQuote({
        appToken,
        kubeconfig,
        operator,
        planName: plan.name,
        promotionCode: code,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      });
      if (result.kind === "pending-upgrade") {
        setPendingUpgrade(result.pendingUpgrade);
        setStage("recovery");
      } else {
        setQuote(result.quote);
        setPromotionCode(result.quote.promotionCode || code);
      }
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

  const continuePendingUpgrade = () => {
    if (pendingUpgrade == null) {
      return;
    }
    const planIsAvailable = snapshot.plans.some(
      (candidate) => candidate.name === pendingUpgrade.planName
    );
    if (!planIsAvailable) {
      setError(
        `Plan ${pendingUpgrade.planName} is no longer available. Cancel this payment to choose another plan.`
      );
      return;
    }

    services.openCheckoutUrl(pendingUpgrade.paymentUrl);
    setCheckout({
      invoiceId: pendingUpgrade.invoiceId,
      payId: pendingUpgrade.paymentId,
      redirectUrl: pendingUpgrade.paymentUrl,
      success: true,
    });
    setError(null);
    setWaitingStartedAt(now());
    setWaitingStatus("polling");
    setStage("waiting");
  };

  const cancelPendingUpgrade = async () => {
    if (
      pendingUpgrade == null ||
      plan == null ||
      (operator !== "created" && operator !== "upgraded") ||
      submitting
    ) {
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      await services.cancelInvoice({
        appToken,
        invoiceId: pendingUpgrade.invoiceId,
        kubeconfig,
        regionDomain: snapshot.current.regionDomain,
        workspace: snapshot.current.workspace,
      });
    } catch (cause) {
      setError(
        errorDescription(
          cause,
          "The unpaid upgrade invoice could not be cancelled."
        )
      );
      setSubmitting(false);
      return;
    }

    setPendingUpgrade(null);
    setQuote(null);
    setStage("quote");
    try {
      const [, result] = await Promise.all([
        onSubscriptionChanged(),
        services.loadUpgradeQuote({
          appToken,
          kubeconfig,
          operator,
          planName: plan.name,
          ...(promotionCode.trim() === ""
            ? {}
            : { promotionCode: promotionCode.trim() }),
          regionDomain: snapshot.current.regionDomain,
          workspace: snapshot.current.workspace,
        }),
      ]);
      if (result.kind === "pending-upgrade") {
        setPendingUpgrade(result.pendingUpgrade);
        setStage("recovery");
      } else {
        setQuote(result.quote);
      }
    } catch (cause) {
      setError(
        errorDescription(
          cause,
          "The prorated upgrade amount could not be calculated."
        )
      );
    } finally {
      setSubmitting(false);
    }
  };

  // Mirrors the legacy costcenter: an exceeded quota warns but never blocks —
  // the downgrade lands at period end and the user gets the rest of the cycle
  // to shrink usage.
  const confirmDowngrade = async () => {
    if (plan == null || submitting) {
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const nextCheckout = await services.createPayment({
        appToken,
        kubeconfig,
        operator: "downgraded",
        planName: plan.name,
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
      onClose();
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
        onClose();
        return;
      }
      if (result.kind === "failed") {
        setError(null);
        setWaitingStatus("failed");
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
    onClose,
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
      onClose();
    } catch (cause) {
      const cancellationError = errorDescription(
        cause,
        "The unpaid upgrade invoice could not be cancelled."
      );
      const result = await checkUpgradePayment({
        checkoutPayId: checkout?.payId,
        credentials: { appToken, kubeconfig },
        onSubscriptionChanged,
        regionDomain: snapshot.current.regionDomain,
        services,
        workspace: snapshot.current.workspace,
      });
      if (result.kind === "completed") {
        onClose();
        return;
      }
      if (result.kind === "failed") {
        setError(cancellationError);
        setWaitingStatus("failed");
        return;
      }
      setError(result.error ?? cancellationError);
      setWaitingStatus("polling");
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        // Recovery and payment waiting must resolve through their own
        // actions, so Esc and outside presses cannot abandon the invoice.
        if (!nextOpen && stage !== "recovery" && stage !== "waiting") {
          onDismiss();
        }
      }}
      open={open}
    >
      <AppDialog.Content
        className={
          stage === "quote" ? "data-[size=lg]:sm:max-w-[868px]" : undefined
        }
        overlayClassName={nested ? NESTED_DIALOG_OVERLAY : undefined}
        size={stage === "quote" ? "lg" : "default"}
      >
        {stage === "waiting" ? (
          <WaitingStage
            error={error}
            onCancel={cancelWaitingPayment}
            onReopen={() => {
              if (checkout?.redirectUrl != null) {
                services.openCheckoutUrl(checkout.redirectUrl);
                if (waitingStatus !== "polling") {
                  setError(null);
                  setWaitingStartedAt(now());
                  setWaitingStatus("polling");
                }
              }
            }}
            status={waitingStatus}
          />
        ) : null}
        {stage === "recovery" && pendingUpgrade != null ? (
          <RecoveryStage
            cancelling={submitting}
            error={error}
            onCancel={cancelPendingUpgrade}
            onContinue={continuePendingUpgrade}
            pendingUpgrade={pendingUpgrade}
          />
        ) : null}
        {stage === "downgrade" && plan != null ? (
          <DowngradeStage
            check={downgradeCheck}
            error={error}
            onConfirm={confirmDowngrade}
            plan={plan}
            submitting={submitting}
          />
        ) : null}
        {stage === "quote" && plan != null ? (
          <QuoteStage
            card={snapshot.card}
            currency={currency}
            error={error}
            gpuEnabled={gpuEnabled}
            onApplyPromotion={applyPromotionCode}
            onConfirm={confirmUpgrade}
            onManageCard={onManageCard}
            onPromotionCodeChange={(value) => {
              setPromotionCode(value);
              setPromotionError(null);
            }}
            plan={plan}
            promotionCode={promotionCode}
            promotionError={promotionError}
            promotionPending={promotionPending}
            quote={quote}
            submitting={submitting}
          />
        ) : null}
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export type {
  BillingPlanChangeServices,
  BillingPlanCheckoutDialogProps,
  CheckoutWindowHandle,
};
export { DEFAULT_PLAN_CHANGE_SERVICES, planOperator };
