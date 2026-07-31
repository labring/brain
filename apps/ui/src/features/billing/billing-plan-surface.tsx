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
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Badge } from "@workspace/ui/components/badge";
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
  ArrowDownRight,
  ArrowRightLeft,
  ArrowUpRight,
  CalendarClock,
  CircleCheck,
  CircleX,
  CreditCard,
  ExternalLink,
  Info,
  RotateCcw,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
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

function formatDate(value: string | null): string {
  if (value == null || value.trim() === "") {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : DATE_FORMATTER.format(date);
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
}: {
  current: BillingPlanSnapshot["current"];
  invoiceCancellationPending: boolean;
  onCancelInvoice?: (invoiceId: string) => void;
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
    </div>
  );
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
  return (
    <section
      className="rounded-xl border border-border bg-card p-2 shadow-xs"
      data-slot="billing-payment-method-section"
    >
      <div className="flex min-h-20 flex-col gap-3 rounded-lg bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-input/40 text-muted-foreground">
            <CreditCard aria-hidden className="size-5" strokeWidth={1.75} />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="font-medium text-foreground text-sm">
              Payment method
            </h2>
            <p className="text-muted-foreground text-sm">
              {card == null
                ? "No saved card"
                : `${cardBrand(card.brand)} ending in ${card.last4}`}
            </p>
          </div>
        </div>
        {card != null && canManage ? (
          <AppButton
            className="self-stretch sm:self-auto"
            disabled={isPending}
            onClick={onManageCard}
            variant="secondary"
          >
            <ExternalLink aria-hidden data-icon="inline-start" />
            {isPending ? "Opening..." : "Manage card"}
          </AppButton>
        ) : null}
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
    <div className="flex flex-wrap gap-2">
      {canRenew ? (
        <AppButton
          disabled={renewalPending || actionPending != null}
          onClick={onRenew}
          size="lg"
        >
          <CreditCard aria-hidden data-icon="inline-start" />
          {renewalPending ? "Opening..." : "Renew subscription"}
        </AppButton>
      ) : null}
      <AppButton
        disabled={actionPending != null}
        onClick={() => onPlanChange?.(null)}
        size="lg"
        variant="secondary"
      >
        <ArrowRightLeft aria-hidden data-icon="inline-start" />
        Change plan
      </AppButton>
      {canResume ? (
        <AppButton
          disabled={actionPending != null}
          onClick={() => onLifecycleAction?.("resumed")}
          size="lg"
        >
          <RotateCcw aria-hidden data-icon="inline-start" />
          {actionPending === "resumed" ? "Resuming..." : "Resume subscription"}
        </AppButton>
      ) : null}
      {canCancel ? (
        <AlertDialog
          onOpenChange={setCancelDialogOpen}
          open={cancelDialogOpen}
          triggerId="billing-cancel-subscription-trigger"
        >
          <AlertDialogTrigger
            className={cn(
              appButtonVariants({ size: "lg", variant: "secondary" }),
              "cursor-pointer"
            )}
            disabled={actionPending != null}
            id="billing-cancel-subscription-trigger"
          >
            Cancel subscription
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
              <AlertDialogDescription>
                {current.planName} remains active until{" "}
                {formatDate(current.currentPeriodEndAt)}. You can resume it
                before then.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={actionPending != null}>
                Keep subscription
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={actionPending != null}
                onClick={() => {
                  setCancelDialogOpen(false);
                  onLifecycleAction?.("canceled");
                }}
                variant="destructive"
              >
                {actionPending === "canceled"
                  ? "Cancelling..."
                  : "Cancel subscription"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
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

  return (
    <div className="flex flex-col gap-8 pb-16" data-slot="billing-plan-surface">
      <BillingPlanNotices
        current={current}
        invoiceCancellationPending={invoiceCancellationPending}
        onCancelInvoice={onCancelInvoice}
      />

      <section
        className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs"
        data-slot="billing-plan-summary"
      >
        <div className="flex flex-col gap-5 bg-muted/30 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-sm">
                Current workspace plan
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-2xl text-foreground">
                  {current.planName}
                </h2>
                <Badge variant={lifecycleMetadata.variant}>
                  {lifecycleMetadata.label}
                </Badge>
                {snapshot.pendingUpgrade == null ? null : (
                  <Badge variant="outline">
                    Pending upgrade to {snapshot.pendingUpgrade.planName}
                  </Badge>
                )}
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

          <div className="grid gap-3 sm:grid-cols-3">
            {current.resources.length > 0 ? (
              current.resources.map((resource) => (
                <div className="flex items-center gap-2" key={resource.label}>
                  <CircleCheck
                    aria-hidden
                    className="size-4 text-primary"
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

        <dl className="grid gap-px border-border border-t bg-border sm:grid-cols-3">
          <div className="flex flex-col gap-2 bg-card px-6 py-5">
            <dt className="text-muted-foreground text-sm">Price per month</dt>
            <dd className="font-medium text-foreground tabular-nums">
              {formatBillingAmount(current.priceMicroUnits, currency)}
            </dd>
          </div>
          <div className="flex flex-col gap-2 bg-card px-6 py-5">
            <dt className="text-muted-foreground text-sm">Quota resets on</dt>
            <dd className="font-medium text-foreground">
              {current.cancelAtPeriodEnd
                ? "-"
                : formatDate(current.currentPeriodEndAt)}
            </dd>
          </div>
          <div className="flex flex-col gap-2 bg-card px-6 py-5">
            <dt className="text-muted-foreground text-sm">Expiration time</dt>
            <dd className="font-medium text-foreground">
              {formatDate(current.expireAt)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        className="rounded-xl border border-border bg-card p-2 shadow-xs"
        data-slot="billing-balance-section"
      >
        <div className="flex min-h-24 items-center rounded-lg bg-muted/30 px-6 py-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-muted-foreground text-sm">
              Account Balance
            </span>
            {balance}
          </div>
        </div>
      </section>

      <BillingPaymentMethod
        canManage={current.canManage}
        card={snapshot.card}
        isPending={cardManagementPending}
        onManageCard={onManageCard}
      />

      <section data-slot="billing-all-plans-section">
        <h2 className="mb-4 font-medium text-foreground text-lg">
          Compare plans
        </h2>
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          data-slot="subscription-plan-comparison"
        >
          {snapshot.plans.map((plan) => (
            <article
              className="flex min-h-64 flex-col gap-5 rounded-xl border border-border bg-card p-5 shadow-xs"
              key={plan.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-foreground text-lg">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {plan.description}
                  </p>
                </div>
                {plan.isCurrent ? <Badge>Current</Badge> : null}
              </div>
              <p className="font-semibold text-2xl text-foreground tabular-nums">
                {formatBillingAmount(plan.priceMicroUnits, currency)}
                <span className="font-normal text-muted-foreground text-sm">
                  /month
                </span>
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.resources.map((resource) => (
                  <li className="flex items-center gap-2" key={resource.label}>
                    <CircleCheck aria-hidden className="size-4 text-primary" />
                    <span className="text-muted-foreground">
                      {resource.value} {resource.label}
                    </span>
                  </li>
                ))}
              </ul>
              {current.canManage && plan.changeKind != null ? (
                <AppButton
                  className="mt-auto w-full"
                  onClick={() => onPlanChange?.(plan.id)}
                  variant="secondary"
                >
                  {plan.changeKind === "upgrade" ? (
                    <ArrowUpRight aria-hidden data-icon="inline-start" />
                  ) : (
                    <ArrowDownRight aria-hidden data-icon="inline-start" />
                  )}
                  {plan.changeKind === "upgrade" ? "Upgrade" : "Downgrade"} to{" "}
                  {plan.name}
                </AppButton>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section data-slot="billing-all-workspaces-section">
        <h2 className="mb-4 font-medium text-foreground text-lg">
          All workspaces
        </h2>
        <TableLayout>
          <TableLayoutCaption className="font-medium">
            Recent spend covers the last 31 days
          </TableLayoutCaption>
          <TableLayoutContent>
            <TableLayoutHeadRow>
              <TableHead>Workspace</TableHead>
              <TableHead>Subscription</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Recent spend</TableHead>
            </TableLayoutHeadRow>
            <TableLayoutBody>
              {snapshot.workspaces.map((workspace) => (
                <TableRow key={workspace.id}>
                  <TableCell className="h-14">
                    <div className="flex items-center gap-2.5">
                      <Avatar size="sm">
                        <AvatarFallback>
                          {workspace.name.trim().charAt(0).toUpperCase() || "W"}
                        </AvatarFallback>
                      </Avatar>
                      <span>{workspace.name}</span>
                      {workspace.isCurrent ? (
                        <Badge variant="outline">Current</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{workspace.planName}</TableCell>
                  <TableCell>
                    <Badge
                      variant={LIFECYCLE_METADATA[workspace.lifecycle].variant}
                    >
                      {LIFECYCLE_METADATA[workspace.lifecycle].label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBillingAmount(
                      workspace.recentSpendMicroUnits,
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
