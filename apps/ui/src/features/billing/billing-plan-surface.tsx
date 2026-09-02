"use client";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { Badge } from "@workspace/ui/components/badge";
import { PlanBadge } from "@workspace/ui/components/plan-badge";
import { Separator } from "@workspace/ui/components/separator";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { WorkspaceAvatar } from "@workspace/ui/components/workspace-avatar";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertCircle,
  CalendarClock,
  CircleCheck,
  CircleX,
  CreditCard,
  Dock,
  ExternalLink,
  Info,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { accountDebtFromMoney } from "@/features/billing/account-debt";
import {
  type AiCredits,
  aiCreditsPercentUsed,
  formatAiCredits,
} from "@/features/billing/billing-ai-credits";
import { formatBillingAmount } from "@/features/billing/billing-amount";
import { TOP_UP_DESKTOP } from "@/features/billing/billing-cta";
import { formatBillingDateTime } from "@/features/billing/billing-datetime";
import {
  type BillingPlanSnapshot,
  type SubscriptionLifecycle,
  type SubscriptionLifecycleAction,
  type SubscriptionLifecycleOutcome,
  type SubscriptionWarningStage,
  subscriptionLifecycleAllowsBillingActions,
} from "@/features/billing/billing-plan-data";
import { BILLING_SURFACE_TONES } from "@/features/billing/billing-surface-tones";
import type { BillingCurrency } from "@/features/billing/config-core";
import { useSealosDesktopUrl } from "@/lib/sealos-desktop-url";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const FREE_PLAN_EXPIRY_WARNING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const CARD_BRANDS: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

// The brand tiles restored from the legacy costcenter asset set; anything
// outside it falls back to the generic card glyph.
const CARD_BRAND_ASSETS = new Set([
  "amex",
  "diners",
  "discover",
  "jcb",
  "mastercard",
  "unionpay",
  "visa",
]);

// The Brain V2.0 plan-summary recipe: the tier gradient at 12% as the panel
// wash and at full strength clipped into the title — the plan-badge palette
// with its STANDARD→PRO / PLUS→ENTERPRISE aliases. Free, PAYG, and unknown
// names keep a neutral input/30 panel.
const PRO_SUMMARY_RECIPE = {
  panel: "bg-linear-to-r from-tier-pro-from/12 to-tier-pro-to/12",
  title:
    "bg-linear-to-r from-tier-pro-from to-tier-pro-to bg-clip-text text-transparent",
};
const ENTERPRISE_SUMMARY_RECIPE = {
  panel: "bg-linear-to-r from-tier-enterprise-from/12 to-tier-enterprise-to/12",
  title:
    "bg-linear-to-r from-tier-enterprise-from to-tier-enterprise-to bg-clip-text text-transparent",
};
const PLAN_SUMMARY_RECIPES: Record<string, { panel: string; title: string }> = {
  ENTERPRISE: ENTERPRISE_SUMMARY_RECIPE,
  HOBBY: {
    panel: "bg-linear-to-r from-tier-hobby-from/12 to-tier-hobby-to/12",
    title:
      "bg-linear-to-r from-tier-hobby-from to-tier-hobby-to bg-clip-text text-transparent",
  },
  PLUS: ENTERPRISE_SUMMARY_RECIPE,
  PRO: PRO_SUMMARY_RECIPE,
  STANDARD: PRO_SUMMARY_RECIPE,
  STARTER: {
    panel: "bg-linear-to-r from-tier-starter-from/12 to-tier-starter-to/12",
    title:
      "bg-linear-to-r from-tier-starter-from to-tier-starter-to bg-clip-text text-transparent",
  },
  TEAM: {
    panel: "bg-linear-to-r from-tier-team-from/12 to-tier-team-to/12",
    title:
      "bg-linear-to-r from-tier-team-from to-tier-team-to bg-clip-text text-transparent",
  },
};

// While the subscription warning is up, the panel trades the tier gradient
// for a wash matching the banner's severity — an amber caution while
// cancelling, orange→red once expiry hits — and the title drops the tier
// tint.
const WARNING_SUMMARY_RECIPES: Record<
  SubscriptionWarningStage,
  { panel: string; title: string }
> = {
  cancelling: {
    panel: "bg-linear-to-r from-amber-400/10 to-orange-400/10",
    title: "text-foreground",
  },
  "deletion-imminent": {
    panel: "bg-linear-to-r from-orange-500/10 to-red-500/10",
    title: "text-foreground",
  },
  expired: {
    panel: "bg-linear-to-r from-orange-500/10 to-red-500/10",
    title: "text-foreground",
  },
};

function formatDate(value: string | null): string {
  if (value == null || value.trim() === "") {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : DATE_FORMATTER.format(date);
}

function formatDateTime(value: string | null): string {
  if (value == null || value.trim() === "") {
    return "-";
  }
  return formatBillingDateTime(value);
}

// Badge shape is uniform (filled pill); color carries the meaning: gray for
// neutral facts, yellow for pending changes, red for expiry. Lifecycles with
// no badge of their own: active needs none, pending-upgrade is voiced by the
// "Pending upgrade to X" change badge instead.
const LIFECYCLE_METADATA = {
  active: null,
  cancelling: { label: "Cancelling", variant: "secondary" },
  "payment-due": { label: "Plan Expired", variant: "destructive" },
  "pending-upgrade": null,
  unavailable: { label: "Status unavailable", variant: "secondary" },
} as const satisfies Record<
  SubscriptionLifecycle,
  {
    label: string;
    variant: "destructive" | "secondary";
  } | null
>;

function WorkspaceLifecycleBadge({
  lifecycle,
}: {
  lifecycle: SubscriptionLifecycle;
}) {
  const metadata = LIFECYCLE_METADATA[lifecycle];
  if (metadata == null) {
    return null;
  }
  return <Badge variant={metadata.variant}>{metadata.label}</Badge>;
}

function cardBrand(brand: string): string {
  const normalized = brand.trim().toLowerCase();
  return CARD_BRANDS[normalized] ?? (brand.trim() || "Card");
}

function isNearFutureExpiry(value: string): boolean {
  const timeUntilExpiry = new Date(value).getTime() - Date.now();
  return (
    timeUntilExpiry > 0 && timeUntilExpiry <= FREE_PLAN_EXPIRY_WARNING_WINDOW_MS
  );
}

// Copy per warning stage: a scannable title plus a description split around
// the bolded deadline — the suspension date while cancelling, the derived
// deletion date once expired. "Expired" (not "payment failed"/"cancelled")
// is the platform's own wording for the suspended stage: a failed renewal
// and a cancelled-then-lapsed period both land in the same deletion
// pipeline. `fallback` voices the deadline when no date could be derived.
const SUBSCRIPTION_WARNING_COPY: Record<
  SubscriptionWarningStage,
  { after: string; before: string; fallback: string; title: string }
> = {
  cancelling: {
    after:
      " and its resources deleted soon after. Back up your data or renew to avoid loss.",
    before: "Your workspace will be suspended after ",
    fallback: "the paid period ends",
    title: "Your subscription is cancelled",
  },
  "deletion-imminent": {
    after: ". Renew now to avoid data loss.",
    before: "All resources will be permanently deleted after ",
    fallback: "the grace period ends",
    title: "Workspace scheduled for deletion",
  },
  expired: {
    after: ". Renew to avoid loss.",
    before: "Your workspace is suspended and resources will be deleted after ",
    fallback: "the grace period ends",
    title: "Your subscription has expired",
  },
};

// An expired Free plan rides the same Deletion Countdown as a paid plan, but
// its recovery voice is "resubscribe": nothing was ever charged, so the copy
// asks for an upgrade, never a renewal. Free cannot reach "cancelling" (the
// lifecycle exempts the constructed cancel-at-period-end flag), hence the
// partial record.
const RESUBSCRIBE_WARNING_COPY: Partial<
  Record<
    SubscriptionWarningStage,
    { after: string; before: string; fallback: string; title: string }
  >
> = {
  "deletion-imminent": {
    after: ". Upgrade now to avoid data loss.",
    before: "All resources will be permanently deleted after ",
    fallback: "the grace period ends",
    title: "Workspace scheduled for deletion",
  },
  expired: {
    after: ". Upgrade to a paid plan to avoid loss.",
    before: "Your workspace is suspended and resources will be deleted after ",
    fallback: "the grace period ends",
    title: "Your Free plan has expired",
  },
};

// Account Debt (a PAYG workspace whose Account Balance is in debt) is the
// balance pipeline, not the subscription Deletion Countdown: there is no
// subscription to expire and no timestamps to derive a deadline from, so the
// copy names the debt and points at a Desktop top-up instead of promising a
// date. PAYG never reaches the "cancelling" stage — its lifecycle is only
// ever active or payment-due — hence the partial record.
const ACCOUNT_DEBT_WARNING_COPY: Partial<
  Record<SubscriptionWarningStage, { description: string; title: string }>
> = {
  "deletion-imminent": {
    description:
      "All resources will be permanently deleted soon. Top up your balance now to avoid data loss.",
    title: "Workspace scheduled for deletion",
  },
  expired: {
    description:
      "This workspace is suspended. Top up your balance to restore it and avoid data loss.",
    title: "Your account balance is in debt",
  },
};

// Severity escalates with the deletion countdown: a pending cancellation is
// still a caution (amber), while an expired or deletion-bound workspace is
// destructive (red). The semantic color stays on the icon and title only —
// the description keeps its muted default.
const SUBSCRIPTION_WARNING_TONES: Record<SubscriptionWarningStage, string> = {
  cancelling: BILLING_SURFACE_TONES.warning,
  "deletion-imminent": BILLING_SURFACE_TONES.destructive,
  expired: BILLING_SURFACE_TONES.destructive,
};

function SubscriptionWarningBanner({
  current,
}: {
  current: BillingPlanSnapshot["current"];
}) {
  const topUpUrl = useSealosDesktopUrl("system-costcenter");
  const stage = current.warningStage;
  if (stage == null) {
    return null;
  }

  const accountDebtCopy = current.isPayg
    ? ACCOUNT_DEBT_WARNING_COPY[stage]
    : undefined;
  if (accountDebtCopy != null) {
    return (
      <Alert
        className={cn(
          "border-none has-data-[slot=alert-action]:pr-4",
          SUBSCRIPTION_WARNING_TONES[stage]
        )}
        data-slot="billing-subscription-warning"
      >
        <TriangleAlert aria-hidden />
        <AlertTitle>{accountDebtCopy.title}</AlertTitle>
        <AlertDescription>{accountDebtCopy.description}</AlertDescription>
        {topUpUrl == null ? null : (
          <AlertAction className="static col-start-2 row-start-3 mt-2 flex flex-wrap gap-2 justify-self-start">
            <AppButton
              nativeButton={false}
              render={
                <a href={topUpUrl} rel="noreferrer" target="_blank">
                  <ExternalLink aria-hidden data-icon="inline-start" />
                  Top up in Sealos Desktop
                </a>
              }
              size="sm"
              variant="danger"
            />
          </AlertAction>
        )}
      </Alert>
    );
  }

  const copy =
    (current.recoveryVoice === "resubscribe"
      ? RESUBSCRIBE_WARNING_COPY[stage]
      : undefined) ?? SUBSCRIPTION_WARNING_COPY[stage];

  return (
    <Alert
      className={cn("border-none", SUBSCRIPTION_WARNING_TONES[stage])}
      data-slot="billing-subscription-warning"
    >
      <TriangleAlert aria-hidden />
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        {copy.before}
        <strong className="font-semibold text-foreground">
          {current.warningDeadlineAt == null
            ? copy.fallback
            : formatDate(current.warningDeadlineAt)}
        </strong>
        {copy.after}
      </AlertDescription>
    </Alert>
  );
}

function BillingInvoiceNotice({
  current,
  invoiceCancellationPending,
  onCancelInvoice,
  pendingUpgrade,
  pendingUpgradePlanAvailable,
}: {
  current: BillingPlanSnapshot["current"];
  invoiceCancellationPending: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  pendingUpgrade: BillingPlanSnapshot["pendingUpgrade"];
  pendingUpgradePlanAvailable: boolean;
}) {
  const invoiceId = current.invoiceId;
  const billingActionsAllowed = subscriptionLifecycleAllowsBillingActions(
    current.lifecycle
  );
  // A Free plan is never a payment target: without a Pending Subscription
  // Upgrade to recover or cancel, an InvoiceInfo on a Free record is stale
  // upstream data and the payment ask must not render.
  if (current.recoveryVoice === "resubscribe" && pendingUpgrade == null) {
    return null;
  }
  const pendingUpgradeUnavailable =
    pendingUpgrade != null && !pendingUpgradePlanAvailable;
  // Deliberately independent of warningStage: payment-due and cancelling are
  // exactly when the invoice actions matter most (AIM-253). Paying a stale
  // pending upgrade is the one hard exclusion — the plan no longer exists.
  const canPayInvoice =
    billingActionsAllowed &&
    current.invoicePaymentUrl != null &&
    !pendingUpgradeUnavailable;
  const canCancelInvoice =
    billingActionsAllowed &&
    current.canManage &&
    invoiceId != null &&
    onCancelInvoice != null;

  if (!(canPayInvoice || canCancelInvoice)) {
    return null;
  }

  return (
    <Alert
      className={cn(
        "border-none has-data-[slot=alert-action]:pr-4",
        SUBSCRIPTION_WARNING_TONES["deletion-imminent"]
      )}
    >
      <AlertCircle aria-hidden />
      <AlertTitle>
        {pendingUpgradeUnavailable
          ? "Pending upgrade unavailable"
          : "You have an unpaid invoice"}
      </AlertTitle>
      <AlertDescription>
        {pendingUpgradeUnavailable && pendingUpgrade != null
          ? `Plan ${pendingUpgrade.planName} is no longer available. Cancel this payment to choose another plan.`
          : "Complete payment to keep this workspace active."}
      </AlertDescription>
      <AlertAction className="static col-start-2 row-start-3 mt-2 flex flex-wrap gap-2 justify-self-start">
        {canPayInvoice && current.invoicePaymentUrl != null ? (
          <AppButton
            nativeButton={false}
            render={
              <a
                href={current.invoicePaymentUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden data-icon="inline-start" />
                Pay invoice
              </a>
            }
            size="sm"
            variant="danger"
          />
        ) : null}
        {canCancelInvoice && invoiceId != null && onCancelInvoice != null ? (
          <AppButton
            disabled={invoiceCancellationPending}
            onClick={() => onCancelInvoice(invoiceId)}
            size="sm"
            variant="secondary"
          >
            <CircleX aria-hidden data-icon="inline-start" />
            {invoiceCancellationPending ? "Cancelling..." : "Cancel invoice"}
          </AppButton>
        ) : null}
      </AlertAction>
    </Alert>
  );
}

function BillingPlanNotices({
  current,
  invoiceCancellationPending,
  onCancelInvoice,
  pendingDowngrade,
  pendingUpgrade,
  pendingUpgradePlanAvailable,
  transactionAvailability,
}: {
  current: BillingPlanSnapshot["current"];
  invoiceCancellationPending: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  pendingDowngrade: BillingPlanSnapshot["pendingDowngrade"];
  pendingUpgrade: BillingPlanSnapshot["pendingUpgrade"];
  pendingUpgradePlanAvailable: boolean;
  transactionAvailability: BillingPlanSnapshot["availability"]["transaction"];
}) {
  const isFreePlan = current.planName.trim().toLowerCase() === "free";

  return (
    <div className="flex flex-col gap-3" data-slot="billing-plan-notices">
      {current.lifecycle === "unavailable" ? (
        <Alert>
          <AlertCircle aria-hidden />
          <AlertTitle>Subscription status unavailable</AlertTitle>
          <AlertDescription>
            Plan changes are disabled until the subscription status can be
            confirmed.
          </AlertDescription>
        </Alert>
      ) : null}

      <SubscriptionWarningBanner current={current} />

      {transactionAvailability === "unavailable" ? (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Recent plan changes unavailable</AlertTitle>
          <AlertDescription>
            Refresh the page to check pending upgrades or downgrades.
          </AlertDescription>
        </Alert>
      ) : null}

      <BillingInvoiceNotice
        current={current}
        invoiceCancellationPending={invoiceCancellationPending}
        onCancelInvoice={onCancelInvoice}
        pendingUpgrade={pendingUpgrade}
        pendingUpgradePlanAvailable={pendingUpgradePlanAvailable}
      />

      {isFreePlan && isNearFutureExpiry(current.currentPeriodEndAt) ? (
        <Alert>
          <CalendarClock aria-hidden />
          <AlertTitle>
            The Free plan expires on {formatDate(current.currentPeriodEndAt)}
          </AlertTitle>
          <AlertDescription>
            Choose a paid plan before this date to keep your current capacity.
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingDowngrade == null ? null : (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>
            Downgrade to {pendingDowngrade.planName} starts on{" "}
            {formatDate(pendingDowngrade.startsAt)}
          </AlertTitle>
          <AlertDescription>
            Reduce this workspace's usage to the {pendingDowngrade.planName}{" "}
            limits before then to avoid extra charges.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function cardExpiryLabel(card: NonNullable<BillingPlanSnapshot["card"]>) {
  if (card.expMonth == null || card.expYear == null) {
    return null;
  }
  const month = String(card.expMonth).padStart(2, "0");
  const year = String(card.expYear).slice(-2);
  return `${month}/${year}`;
}

function BillingPaymentMethod({
  availability,
  canManage,
  card,
  isPending,
  onManageCard,
}: {
  availability: BillingPlanSnapshot["availability"]["card"];
  canManage: boolean;
  card: BillingPlanSnapshot["card"];
  isPending: boolean;
  onManageCard?: () => void;
}) {
  if (availability === "unavailable") {
    return (
      <section
        className="flex min-h-20 items-center gap-3 rounded-xl bg-input/30 p-4"
        data-slot="billing-payment-method-section"
        role="status"
      >
        <CreditCard
          aria-hidden
          className="size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-foreground text-sm">
            Payment method unavailable
          </h2>
          <p className="text-muted-foreground text-sm">
            Card details could not be loaded.
          </p>
        </div>
      </section>
    );
  }
  if (card == null) {
    return null;
  }

  const brand = card.brand.trim().toLowerCase();
  const expiry = cardExpiryLabel(card);

  return (
    <section
      className="flex flex-col gap-3 rounded-xl bg-input/30 p-4 sm:flex-row sm:items-center sm:justify-between"
      data-slot="billing-payment-method-section"
    >
      <h2 className="sr-only">Payment method</h2>
      <div className="flex min-w-0 items-center gap-3">
        {CARD_BRAND_ASSETS.has(brand) ? (
          // biome-ignore lint/performance/noImgElement: static local brand tile
          <img
            alt={cardBrand(card.brand)}
            className="h-9 w-auto shrink-0"
            height={36}
            src={`/payment-brands/${brand}.svg`}
            width={53}
          />
        ) : (
          <div className="flex h-9 w-13 shrink-0 items-center justify-center rounded-sm bg-input/40 text-muted-foreground">
            <CreditCard aria-hidden className="size-5" strokeWidth={1.75} />
          </div>
        )}
        <span className="font-medium text-foreground text-sm">
          {cardBrand(card.brand)}
        </span>
        <span className="font-medium text-foreground text-sm">
          •••• {card.last4}
        </span>
        {expiry == null ? null : (
          <>
            <div aria-hidden className="h-3 w-px bg-border" />
            <span className="text-muted-foreground text-xs">EXP: {expiry}</span>
          </>
        )}
      </div>
      {canManage ? (
        <AppButton
          className="self-stretch sm:self-auto"
          disabled={isPending}
          onClick={onManageCard}
          variant="secondary"
        >
          {isPending ? "Opening..." : "Manage Card Info"}
        </AppButton>
      ) : null}
    </section>
  );
}

function AiCreditsMetric({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2">
      <span className="text-muted-foreground text-sm leading-5">
        AI Credits
      </span>
      {children}
    </div>
  );
}

function AiCreditsBody({
  credits,
  error,
  isLoading,
}: {
  credits: AiCredits | undefined;
  error: unknown;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <AiCreditsMetric>
        <Skeleton aria-label="Loading AI Credits" className="h-6 w-36" />
      </AiCreditsMetric>
    );
  }
  if (error != null) {
    return (
      <AiCreditsMetric>
        <p className="text-destructive text-sm leading-5" role="alert">
          Couldn’t load AI Credits.
        </p>
      </AiCreditsMetric>
    );
  }
  if (credits == null) {
    return null;
  }
  const percent = aiCreditsPercentUsed(
    credits.usedMicroUnits,
    credits.totalMicroUnits
  );
  const used = formatAiCredits(credits.usedMicroUnits);
  const total = formatAiCredits(credits.totalMicroUnits);
  const usedTotal = `${used} / ${total}`;
  return (
    <>
      <AiCreditsMetric>
        <p className="flex items-baseline gap-1 whitespace-nowrap font-semibold text-foreground tabular-nums">
          <span className="text-2xl leading-none">{used}</span>
          <span className="text-base leading-none">/ {total}</span>
        </p>
      </AiCreditsMetric>
      <div
        aria-label="AI Credits used"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        aria-valuetext={usedTotal}
        className="h-2 w-full overflow-hidden rounded-full bg-input"
        role="progressbar"
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-blue-950 to-blue-500"
          style={{ width: `${percent}%` }}
        />
      </div>
    </>
  );
}

// The period end speaks with the voice the snapshot derived (AIM-254): a
// renewal for a healthy paid plan, an expiry for Free, or silence when the
// destructive warning banner owns the date.
function BillingPeriodEndFields({
  current,
}: {
  current: BillingPlanSnapshot["current"];
}) {
  const { currentPeriodEndAt, periodEndVoice } = current;
  return (
    <>
      <div className="flex flex-col gap-2">
        <dt className="text-muted-foreground text-sm">
          {periodEndVoice === "expiry" ? "Expires On" : "Quota Resets On"}
        </dt>
        <dd className="font-semibold text-foreground tabular-nums">
          {periodEndVoice === "silent"
            ? "-"
            : formatDateTime(currentPeriodEndAt)}
        </dd>
      </div>
      <div className="flex flex-col gap-2">
        <dt className="text-muted-foreground text-sm">Renewal Time</dt>
        <dd className="font-semibold text-foreground tabular-nums">
          {periodEndVoice === "renewal"
            ? formatDateTime(currentPeriodEndAt)
            : "-"}
        </dd>
      </div>
    </>
  );
}

export function BillingAiCreditsSection({
  credits,
  error,
  isLoading,
  planIncludesCredits,
  resetAt,
  resetLabel = "Resets:",
}: {
  credits: AiCredits | undefined;
  error: unknown;
  isLoading: boolean;
  planIncludesCredits: boolean;
  resetAt: string;
  resetLabel?: string;
}) {
  const readyWithAllowance = credits != null && credits.totalMicroUnits > 0;
  if (
    !(
      readyWithAllowance ||
      (planIncludesCredits && (isLoading || error != null))
    )
  ) {
    return null;
  }

  return (
    <section
      aria-live="polite"
      className="flex min-h-24 flex-col gap-4 rounded-lg bg-input/30 p-4"
      data-slot="billing-ai-credits-section"
    >
      <AiCreditsBody credits={credits} error={error} isLoading={isLoading} />
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-muted-foreground text-sm leading-5">
          {`${resetLabel} `}
        </span>
        <span className="font-semibold text-base text-card-foreground tabular-nums leading-none">
          {resetAt}
        </span>
      </p>
    </section>
  );
}

/**
 * The Account Balance figure (prototype D of AIM-313): the available total —
 * Balance − DeductionBalance + usable credits across every active row, the
 * upstream debt formula — with any remaining new-user gift (and only the
 * gift: plan grants feed the total unlabeled) pinned beside it as a
 * borderless chip. A negative amount tints the figure; the Account Debt
 * caption (recovery is a top-up, never a plan) appears only when the
 * platform's actual debt predicate holds — a PAYG workspace, ever billed,
 * available ≤ 0 — the same judgment the status hint and the walls make.
 * The $5 low-balance threshold deliberately does not tint this persistent
 * display — that voice belongs to notifications.
 */
export function BillingBalanceValue({
  availableMicroUnits,
  creditsResolved,
  currency,
  giftMicroUnits,
  lifetimeDeductionMicroUnits,
  payg,
}: {
  availableMicroUnits: number;
  /**
   * Whether the credits fetch has succeeded. While false the available
   * figure is cash-only, so debt must not be voiced — unseen credits could
   * still cover the account.
   */
  creditsResolved: boolean;
  currency: BillingCurrency;
  giftMicroUnits: number;
  /** Lifetime deductions — zero means the account has never been billed. */
  lifetimeDeductionMicroUnits: number;
  /** Whether this workspace is Pay-As-You-Go — the only mode debt suspends. */
  payg: boolean;
}) {
  // Account Debt holds only where the platform would actually suspend: a
  // PAYG workspace on an ever-billed account with nothing available. A
  // subscribed workspace's negative balance still reddens, but carries no
  // service-restoration claim — its resources ride the plan.
  const inDebt =
    creditsResolved &&
    payg &&
    accountDebtFromMoney({
      availableBalanceMicroUnits: availableMicroUnits,
      lifetimeDeductionMicroUnits,
    });
  const tinted = inDebt || (creditsResolved && availableMicroUnits < 0);
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <p
          className={cn(
            "font-semibold text-2xl tabular-nums",
            tinted ? "text-red-400" : "text-foreground"
          )}
        >
          {formatBillingAmount(availableMicroUnits, currency)}
        </p>
        {giftMicroUnits > 0 ? (
          <Badge
            className="self-center bg-blue-600/10 text-blue-600 tabular-nums dark:bg-blue-400/10 dark:text-blue-400"
            variant="secondary"
          >
            Gift {formatBillingAmount(giftMicroUnits, currency)}
          </Badge>
        ) : null}
      </div>
      {inDebt ? <BalanceDebtCaption /> : null}
    </>
  );
}

/** The debt caption links to the one place a top-up exists when it can. */
function BalanceDebtCaption() {
  const topUpUrl = useSealosDesktopUrl(TOP_UP_DESKTOP.app);
  return (
    <p className="text-red-400 text-xs">
      {topUpUrl == null ? (
        "Top up from the Sealos Desktop to restore your services."
      ) : (
        <>
          <a
            className="underline underline-offset-2"
            href={topUpUrl}
            rel="noreferrer"
            target="_blank"
          >
            Top up in Sealos Desktop
          </a>{" "}
          to restore your services.
        </>
      )}
    </p>
  );
}

function BillingBalanceSection({
  balance,
  variant = "panel",
}: {
  balance: ReactNode;
  variant?: "card" | "panel";
}) {
  if (variant === "card") {
    return (
      <section
        className="rounded-xl border border-border bg-card p-2 shadow-xs"
        data-slot="billing-balance-section"
      >
        <div className="flex h-full min-h-24 items-center rounded-lg bg-muted/30 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
              Account Balance
            </span>
            {balance}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      className="flex min-h-24 items-center rounded-xl bg-input/30 px-6 py-5"
      data-slot="billing-balance-section"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-sm">Account Balance</span>
        {balance}
      </div>
    </section>
  );
}

type LifecycleActionHandler = (
  operator: SubscriptionLifecycleAction
) => Promise<SubscriptionLifecycleOutcome> | undefined;

function CancelPlanDialog({
  currentPeriodEndAt,
  disabled,
  onConfirm,
}: {
  currentPeriodEndAt: string | null;
  disabled: boolean;
  onConfirm?: LifecycleActionHandler;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirmCancellation = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await onConfirm?.("canceled");
      if (outcome != null && !outcome.ok) {
        setError(outcome.message);
        return;
      }
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (submitting) {
          return;
        }
        setOpen(nextOpen);
        if (nextOpen) {
          setError(null);
        }
      }}
      open={open}
    >
      <AppDialog.Trigger
        disabled={disabled}
        id="billing-cancel-subscription-trigger"
        render={<AppButton variant="secondary" />}
      >
        Cancel Plan
      </AppDialog.Trigger>
      <AppDialog.Content>
        <AppDialog.Header>
          <AppDialog.WarningIcon className="text-destructive" />
          <AppDialog.Title>We are sorry to see you go</AppDialog.Title>
          <AppDialog.Description className="sr-only">
            Cancelling keeps the plan until the current period ends, after which
            the workspace is suspended and its resources deleted soon after.
          </AppDialog.Description>
        </AppDialog.Header>
        <AppDialog.Body>
          <p className="text-muted-foreground">
            Your resources will be kept until the current subscription period
            ends (
            <span className="font-medium text-destructive">
              {formatDate(currentPeriodEndAt)}
            </span>
            ).{" "}
            <span className="font-medium text-destructive">
              After that, your workspace will be suspended and its resources
              deleted soon after
            </span>
            . Please backup your work in advance to avoid data loss.
          </p>
          {error == null ? null : (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={submitting}>Keep Plan</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            loading={submitting}
            loadingLabel="Cancelling..."
            onClick={confirmCancellation}
          >
            Cancel Plan
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function BillingPlanActions({
  actionPending,
  current,
  onLifecycleAction,
  onPlanChange,
}: {
  actionPending: SubscriptionLifecycleAction | null;
  current: BillingPlanSnapshot["current"];
  onLifecycleAction?: LifecycleActionHandler;
  onPlanChange?: (planId: string | null) => void;
}) {
  if (
    !(
      current.canManage &&
      subscriptionLifecycleAllowsBillingActions(current.lifecycle)
    )
  ) {
    return null;
  }

  const isFreePlan = current.planName.trim().toLowerCase() === "free";
  // One button covers both warning roads: before expiry it revokes the
  // cancellation; after expiry it opens the plan picker so the user can
  // create a replacement subscription, matching the legacy costcenter flow.
  // The post-expiry label follows the recovery voice — an expired Free plan
  // asks for an upgrade, never a renewal.
  const canResume = current.lifecycle === "cancelling";
  const canRenew = current.lifecycle === "payment-due";
  const canCancel =
    (current.lifecycle === "active" ||
      current.lifecycle === "pending-upgrade") &&
    !isFreePlan;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canCancel ? (
        <CancelPlanDialog
          currentPeriodEndAt={current.currentPeriodEndAt}
          disabled={actionPending != null}
          onConfirm={onLifecycleAction}
        />
      ) : null}
      {canResume ? (
        <AppButton
          disabled={actionPending != null}
          onClick={() => onLifecycleAction?.("resumed")}
        >
          <Sparkles aria-hidden data-icon="inline-start" />
          {actionPending === "resumed" ? "Renewing..." : "Renew"}
        </AppButton>
      ) : null}
      {canRenew ? (
        <AppButton
          disabled={actionPending != null}
          onClick={() => onPlanChange?.(null)}
        >
          <Sparkles aria-hidden data-icon="inline-start" />
          {current.recoveryVoice === "resubscribe" ? "Upgrade Plan" : "Renew"}
        </AppButton>
      ) : null}
      {canResume || canRenew ? null : (
        <AppButton
          disabled={actionPending != null}
          onClick={() => onPlanChange?.(null)}
        >
          <Sparkles aria-hidden data-icon="inline-start" />
          Upgrade Plan
        </AppButton>
      )}
    </div>
  );
}

interface BillingPlanSurfaceProps {
  actionPending?: SubscriptionLifecycleAction | null;
  balance: ReactNode;
  cardManagementPending?: boolean;
  credits?: ReactNode;
  currency: BillingCurrency;
  invoiceCancellationPending?: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  onLifecycleAction?: LifecycleActionHandler;
  onManageCard?: () => void;
  onPlanChange?: (planId: string | null) => void;
  snapshot: BillingPlanSnapshot;
}

export function BillingPlanSurface({
  actionPending = null,
  balance,
  cardManagementPending = false,
  credits = null,
  currency,
  invoiceCancellationPending = false,
  onCancelInvoice,
  onLifecycleAction,
  onManageCard,
  onPlanChange,
  snapshot,
}: BillingPlanSurfaceProps) {
  const { current } = snapshot;
  const pendingUpgradePlanAvailable =
    snapshot.pendingUpgrade == null ||
    snapshot.plans.some(
      (plan) => plan.name === snapshot.pendingUpgrade?.planName
    );
  const billingActionsAllowed =
    current.canManage &&
    subscriptionLifecycleAllowsBillingActions(current.lifecycle);
  const lifecycleMetadata = LIFECYCLE_METADATA[current.lifecycle];
  const summaryRecipe =
    current.warningStage == null
      ? PLAN_SUMMARY_RECIPES[current.planName.trim().toUpperCase()]
      : WARNING_SUMMARY_RECIPES[current.warningStage];

  const lifecycleBadges = (
    <>
      {lifecycleMetadata == null || current.warningStage != null ? null : (
        <Badge variant={lifecycleMetadata.variant}>
          {lifecycleMetadata.label}
        </Badge>
      )}
      {snapshot.pendingUpgrade == null ? null : (
        <Badge variant="warning">
          Pending upgrade to {snapshot.pendingUpgrade.planName}
        </Badge>
      )}
      {snapshot.pendingDowngrade == null ? null : (
        <Badge variant="warning">
          Downgrading to {snapshot.pendingDowngrade.planName}
        </Badge>
      )}
    </>
  );

  const planSummary = current.isPayg ? (
    <div className="grid gap-4 lg:grid-cols-3">
      <section
        className="rounded-xl border border-border bg-card p-2 text-card-foreground shadow-xs lg:col-span-2"
        data-slot="billing-plan-summary"
      >
        <div className="flex h-full min-h-24 flex-col justify-between gap-4 rounded-lg bg-muted/30 px-6 py-5 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">
              Current Workspace Plan
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-2xl text-foreground">
                Pay-As-You-Go
              </h2>
              {lifecycleBadges}
            </div>
          </div>
          {billingActionsAllowed ? (
            <AppButton
              disabled={actionPending != null}
              onClick={() => onPlanChange?.(null)}
            >
              <Sparkles aria-hidden data-icon="inline-start" />
              Subscribe Plan
            </AppButton>
          ) : null}
        </div>
      </section>
      <BillingBalanceSection balance={balance} variant="card" />
    </div>
  ) : (
    <section
      className="flex flex-col rounded-xl bg-input/30 p-4"
      data-slot="billing-plan-summary"
    >
      <div
        className={cn(
          "flex flex-col gap-5 rounded-lg p-4",
          summaryRecipe?.panel ?? "bg-input/30"
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">
              Current Workspace Plan
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                className={cn(
                  "w-fit font-semibold text-2xl",
                  summaryRecipe?.title ?? "text-foreground"
                )}
              >
                {current.planName} Plan
              </h2>
              {lifecycleBadges}
            </div>
          </div>

          <BillingPlanActions
            actionPending={actionPending}
            current={current}
            onLifecycleAction={onLifecycleAction}
            onPlanChange={onPlanChange}
          />
        </div>

        <Separator />

        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {current.resources.length > 0 ? (
            current.resources.map((resource) => (
              <div className="flex items-center gap-2" key={resource.label}>
                <CircleCheck
                  aria-hidden
                  className="size-4 shrink-0 text-blue-600 dark:text-blue-400"
                  strokeWidth={1.75}
                />
                <span className="text-muted-foreground text-sm">
                  {resource.label}: {resource.value}
                </span>
              </div>
            ))
          ) : (
            <span className="text-muted-foreground text-sm">
              No included resource quota
            </span>
          )}
        </div>
      </div>

      <dl className="grid gap-4 px-4 pt-5 pb-1 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground text-sm">Price/Month</dt>
          <dd className="font-semibold text-foreground tabular-nums">
            {formatBillingAmount(current.priceMicroUnits, currency)}
          </dd>
        </div>
        <BillingPeriodEndFields current={current} />
      </dl>
    </section>
  );

  return (
    <div className="flex flex-col gap-3" data-slot="billing-plan-surface">
      <BillingPlanNotices
        current={current}
        invoiceCancellationPending={invoiceCancellationPending}
        onCancelInvoice={onCancelInvoice}
        pendingDowngrade={snapshot.pendingDowngrade}
        pendingUpgrade={snapshot.pendingUpgrade}
        pendingUpgradePlanAvailable={pendingUpgradePlanAvailable}
        transactionAvailability={snapshot.availability.transaction}
      />

      {planSummary}

      {credits}

      {current.isPayg ? null : <BillingBalanceSection balance={balance} />}

      <BillingPaymentMethod
        availability={snapshot.availability.card}
        canManage={billingActionsAllowed}
        card={snapshot.card}
        isPending={cardManagementPending}
        onManageCard={onManageCard}
      />

      <section
        className="mt-1 rounded-xl bg-input/30 p-4"
        data-slot="billing-all-workspaces-section"
      >
        <h2 className="mb-4 flex items-center gap-2 font-medium text-foreground">
          <Dock aria-hidden className="size-4" strokeWidth={1.75} />
          All Plans
        </h2>
        {snapshot.availability.workspaces === "unavailable" ? (
          <p
            className="py-6 text-center text-muted-foreground text-sm"
            role="status"
          >
            Workspace plans unavailable
          </p>
        ) : (
          <TableLayout>
            <TableLayoutCaption className="font-medium">
              {current.regionDomain}
            </TableLayoutCaption>
            <TableLayoutContent>
              <TableLayoutHeadRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Renewal Time</TableHead>
                <TableHead className="text-right">Price</TableHead>
              </TableLayoutHeadRow>
              <TableLayoutBody>
                {snapshot.workspaces.map((workspace) => (
                  <TableRow key={workspace.id}>
                    <TableCell className="h-14">
                      <div className="flex items-center gap-2.5">
                        <WorkspaceAvatar workspaceId={workspace.id} />
                        <span>{workspace.name}</span>
                        {workspace.isCurrent ? (
                          <Badge variant="secondary">Current</Badge>
                        ) : null}
                        <WorkspaceLifecycleBadge
                          lifecycle={workspace.lifecycle}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <PlanBadge planName={workspace.planName} />
                    </TableCell>
                    <TableCell>
                      {workspace.lifecycle === "cancelling"
                        ? "-"
                        : formatDateTime(workspace.renewalAt)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {workspace.priceMicroUnits == null
                        ? "—"
                        : formatBillingAmount(
                            workspace.priceMicroUnits,
                            currency
                          )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableLayoutBody>
            </TableLayoutContent>
          </TableLayout>
        )}
      </section>
    </div>
  );
}
