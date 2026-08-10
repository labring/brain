"use client";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog";
import {
  AppButton,
  appButtonVariants,
} from "@workspace/ui/components/app-button";
import { Badge } from "@workspace/ui/components/badge";
import { PlanBadge } from "@workspace/ui/components/plan-badge";
import { Separator } from "@workspace/ui/components/separator";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
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
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import { formatBillingDateTime } from "@/features/billing/billing-datetime";
import type {
  BillingPlanSnapshot,
  SubscriptionLifecycle,
  SubscriptionLifecycleAction,
} from "@/features/billing/billing-plan-data";
import type { BillingCurrency } from "@/features/billing/config-core";

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

const LIFECYCLE_METADATA = {
  active: { label: "Active", variant: "default" },
  cancelling: { label: "Cancelling", variant: "secondary" },
  "payment-due": { label: "Payment due", variant: "destructive" },
  "pending-upgrade": { label: "Pending upgrade", variant: "secondary" },
} as const satisfies Record<
  SubscriptionLifecycle,
  {
    label: string;
    variant: "default" | "destructive" | "outline" | "secondary";
  }
>;

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

function BillingPlanNotices({
  current,
  invoiceCancellationPending,
  onCancelInvoice,
  pendingDowngrade,
}: {
  current: BillingPlanSnapshot["current"];
  invoiceCancellationPending: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  pendingDowngrade: BillingPlanSnapshot["pendingDowngrade"];
}) {
  const isFreePlan = current.planName.trim().toLowerCase() === "free";
  const invoiceId = current.invoiceId;

  return (
    <div className="flex flex-col gap-3" data-slot="billing-plan-notices">
      {current.invoicePaymentUrl == null ? null : (
        <Alert
          className="has-data-[slot=alert-action]:pr-4 sm:has-data-[slot=alert-action]:pr-18"
          variant="destructive"
        >
          <AlertCircle aria-hidden />
          <AlertTitle>You have an unpaid invoice</AlertTitle>
          <AlertDescription>
            Complete payment to keep this workspace active.
          </AlertDescription>
          <AlertAction className="static col-start-2 row-start-3 mt-2 flex flex-wrap gap-2 justify-self-start">
            <a
              className={appButtonVariants({ size: "sm", variant: "danger" })}
              href={current.invoicePaymentUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden data-icon="inline-start" />
              Pay invoice
            </a>
            {current.canManage &&
            invoiceId != null &&
            onCancelInvoice != null ? (
              <AppButton
                disabled={invoiceCancellationPending}
                onClick={() => onCancelInvoice(invoiceId)}
                size="sm"
                variant="secondary"
              >
                <CircleX aria-hidden data-icon="inline-start" />
                {invoiceCancellationPending
                  ? "Cancelling..."
                  : "Cancel invoice"}
              </AppButton>
            ) : null}
          </AlertAction>
        </Alert>
      )}

      {current.cancelAtPeriodEnd && !isFreePlan ? (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Your subscription is being cancelled</AlertTitle>
          <AlertDescription>
            Access continues until {formatDate(current.currentPeriodEndAt)}.
            Resume before then to keep this workspace active.
          </AlertDescription>
        </Alert>
      ) : null}

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
  canManage,
  card,
  isPending,
  onManageCard,
}: {
  canManage: boolean;
  card: BillingPlanSnapshot["card"];
  isPending: boolean;
  onManageCard?: () => void;
}) {
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

function BillingBalanceSection({ balance }: { balance: ReactNode }) {
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

function BillingPlanActions({
  actionPending,
  current,
  onLifecycleAction,
  onPlanChange,
  onRenew,
  renewalPending,
}: {
  actionPending: SubscriptionLifecycleAction | null;
  current: BillingPlanSnapshot["current"];
  onLifecycleAction?: (operator: SubscriptionLifecycleAction) => void;
  onPlanChange?: (planId: string | null) => void;
  onRenew?: () => void;
  renewalPending: boolean;
}) {
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  if (!current.canManage) {
    return null;
  }

  const isFreePlan = current.planName.trim().toLowerCase() === "free";
  const canResume = current.lifecycle === "cancelling";
  const canRenew = current.lifecycle === "payment-due";
  const canCancel =
    (current.lifecycle === "active" ||
      current.lifecycle === "pending-upgrade") &&
    !isFreePlan;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {canCancel ? (
        <AlertDialog
          onOpenChange={setCancelDialogOpen}
          open={cancelDialogOpen}
          triggerId="billing-cancel-subscription-trigger"
        >
          <AlertDialogTrigger
            className={cn(
              appButtonVariants({ variant: "secondary" }),
              "cursor-pointer"
            )}
            disabled={actionPending != null}
            id="billing-cancel-subscription-trigger"
          >
            Cancel Plan
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel Plan?</AlertDialogTitle>
              <AlertDialogDescription>
                {current.planName} remains active until{" "}
                {formatDate(current.currentPeriodEndAt)}. You can resume it
                before then.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={actionPending != null}>
                Keep Plan
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={actionPending != null}
                onClick={() => {
                  setCancelDialogOpen(false);
                  onLifecycleAction?.("canceled");
                }}
                variant="destructive"
              >
                {actionPending === "canceled" ? "Cancelling..." : "Cancel Plan"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {canResume ? (
        <AppButton
          disabled={actionPending != null}
          onClick={() => onLifecycleAction?.("resumed")}
        >
          <RotateCcw aria-hidden data-icon="inline-start" />
          {actionPending === "resumed" ? "Resuming..." : "Resume Plan"}
        </AppButton>
      ) : null}
      {canRenew ? (
        <AppButton
          disabled={renewalPending || actionPending != null}
          onClick={onRenew}
        >
          <CreditCard aria-hidden data-icon="inline-start" />
          {renewalPending ? "Opening..." : "Renew Plan"}
        </AppButton>
      ) : null}
      <AppButton
        disabled={actionPending != null}
        onClick={() => onPlanChange?.(null)}
      >
        <Sparkles aria-hidden data-icon="inline-start" />
        Upgrade Plan
      </AppButton>
    </div>
  );
}

interface BillingPlanSurfaceProps {
  actionPending?: SubscriptionLifecycleAction | null;
  balance: ReactNode;
  cardManagementPending?: boolean;
  currency: BillingCurrency;
  invoiceCancellationPending?: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
  onLifecycleAction?: (operator: SubscriptionLifecycleAction) => void;
  onManageCard?: () => void;
  onPlanChange?: (planId: string | null) => void;
  onRenew?: () => void;
  renewalPending?: boolean;
  snapshot: BillingPlanSnapshot;
}

export function BillingPlanSurface({
  actionPending = null,
  balance,
  cardManagementPending = false,
  currency,
  invoiceCancellationPending = false,
  onCancelInvoice,
  onLifecycleAction,
  onManageCard,
  onPlanChange,
  onRenew,
  renewalPending = false,
  snapshot,
}: BillingPlanSurfaceProps) {
  const { current } = snapshot;
  const lifecycleMetadata = LIFECYCLE_METADATA[current.lifecycle];
  const summaryRecipe =
    PLAN_SUMMARY_RECIPES[current.planName.trim().toUpperCase()];

  const lifecycleBadges = (
    <>
      {current.lifecycle === "active" ? null : (
        <Badge variant={lifecycleMetadata.variant}>
          {lifecycleMetadata.label}
        </Badge>
      )}
      {snapshot.pendingUpgrade == null ? null : (
        <Badge variant="outline">
          Pending upgrade to {snapshot.pendingUpgrade.planName}
        </Badge>
      )}
      {snapshot.pendingDowngrade == null ? null : (
        <Badge variant="outline">
          Downgrading to {snapshot.pendingDowngrade.planName}
        </Badge>
      )}
    </>
  );

  const planSummary = current.isPayg ? (
    <section
      className="rounded-xl bg-input/30 p-4"
      data-slot="billing-plan-summary"
    >
      <div className="flex flex-col justify-between gap-4 rounded-lg bg-input/30 p-4 sm:flex-row sm:items-center">
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
        {current.canManage ? (
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
            onRenew={onRenew}
            renewalPending={renewalPending}
          />
        </div>

        <Separator />

        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {current.resources.length > 0 ? (
            current.resources.map((resource) => (
              <div className="flex items-center gap-2" key={resource.label}>
                <CircleCheck
                  aria-hidden
                  className="size-4 shrink-0 text-blue-400"
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
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground text-sm">Quota Resets On</dt>
          <dd className="font-semibold text-foreground tabular-nums">
            {current.cancelAtPeriodEnd
              ? "-"
              : formatDateTime(current.currentPeriodEndAt)}
          </dd>
        </div>
        <div className="flex flex-col gap-2">
          <dt className="text-muted-foreground text-sm">Renewal Time</dt>
          <dd className="font-semibold text-foreground tabular-nums">
            {formatDateTime(current.expireAt)}
          </dd>
        </div>
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
      />

      {planSummary}

      <BillingBalanceSection balance={balance} />

      <BillingPaymentMethod
        canManage={current.canManage}
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
                      <div
                        aria-hidden
                        className="size-5 shrink-0 rounded-full bg-linear-to-br from-blue-400 to-brand-primary"
                      />
                      <span>{workspace.name}</span>
                      {workspace.isCurrent ? (
                        <Badge variant="outline">Current</Badge>
                      ) : null}
                      {workspace.lifecycle === "payment-due" ? (
                        <Badge variant="destructive">In debt</Badge>
                      ) : null}
                      {workspace.lifecycle === "cancelling" ? (
                        <Badge variant="secondary">Plan Cancelled</Badge>
                      ) : null}
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
      </section>
    </div>
  );
}
