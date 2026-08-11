"use client";

import {
  AppSelect,
  type AppSelectOption,
} from "@workspace/ui/components/app-select";
import { useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import {
  BillingPlanCard,
  type BillingPlanCardState,
  PlanCheckGradientDefs,
  planCardAction,
} from "@/features/billing/billing-plan-card";
import type { NormalizedBillingPlan } from "@/features/billing/billing-plan-catalog";
import type { BillingPlanSnapshot } from "@/features/billing/billing-plan-data";
import type { BillingCurrency } from "@/features/billing/config-core";

type SnapshotPlan = BillingPlanSnapshot["plans"][number];

// The picker renders snapshot plans through the shared pricing-card surface,
// which expects the pricing loader's plan shape.
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
  const price = `${formatBillingAmount(plan.priceMicroUnits, currency)}/mo`;
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

interface BillingPlanPickerProps {
  /**
   * Whether the viewer may change this workspace's subscription. When false
   * the layout stays intact but every plan action is silently absent.
   */
  actionable: boolean;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  inDebt: boolean;
  onOpenUrl: (url: string) => void;
  onSelectPlan?: (planId: string) => void;
  pendingDowngradePlanName: string | null;
  plans: BillingPlanSnapshot["plans"];
}

/**
 * The Plan Picker: subscription-plan cards plus the additional-plans selector,
 * rendered identically by the Pricing view's plans area and the Plan view's
 * plan-change dialog. Selecting an actionable plan hands off to
 * plan checkout — the picker itself never takes payment.
 */
export function BillingPlanPicker({
  actionable,
  currency,
  gpuEnabled,
  inDebt,
  onOpenUrl,
  onSelectPlan,
  pendingDowngradePlanName,
  plans,
}: BillingPlanPickerProps) {
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

  const planStates = actionable
    ? new Map<string, BillingPlanCardState>(
        plans.map((plan) => [
          plan.id,
          {
            changeKind: plan.changeKind ?? null,
            inDebt,
            isCurrent: plan.isCurrent,
            isPendingDowngradeTarget: pendingDowngradePlanName === plan.name,
          },
        ])
      )
    : undefined;
  const standardIndex = cardPlans.findIndex(
    (plan) => plan.name.trim().toUpperCase() === "STANDARD"
  );
  const mostPopularIndex = standardIndex === -1 ? 1 : standardIndex;

  if (cardPlans.length === 0 && morePlans.length === 0) {
    return (
      <div className="border-border border-y py-12 text-center text-muted-foreground text-sm">
        No subscription plans are available.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-slot="billing-plan-picker">
      <PlanCheckGradientDefs />
      <div className="flex flex-col gap-3 lg:flex-row">
        {cardPlans.map((plan, index) => (
          <BillingPlanCard
            action={planCardAction({
              onSelectPlan,
              plan: selectionCardPlan(plan),
              planStates,
              planStatesPending: false,
            })}
            currency={currency}
            gpuEnabled={gpuEnabled}
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
                onSelectPlan,
                plan: selectionCardPlan(selectedMorePlan),
                planStates,
                planStatesPending: false,
              })}
        </div>
      )}
    </div>
  );
}

export type { BillingPlanPickerProps };
