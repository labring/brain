"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import type { ReactNode } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { NormalizedBillingPlan } from "@/features/billing/billing-plan-catalog";
import type { BillingCurrency } from "@/features/billing/config-core";

// Brain V2.0 pricing-card recipe: the tier gradient at 12% as the wash, at
// full strength as the stroke ring, and clipped into the name and price.
// Figma flattens the stroke to its first stop when exporting, so the ring is
// a masked ::before — the same trick as PlanBadge, whose palette aliases we
// share (STANDARD borrows PRO, PLUS borrows ENTERPRISE). Names without a
// recipe — Free and Starter included, per the pricing design — keep the
// neutral card: input/30 fill and a plain border.
const PRO_CARD_RECIPE = {
  ring: "before:from-tier-pro-from before:to-tier-pro-to",
  text: "bg-linear-to-r from-tier-pro-from to-tier-pro-to bg-clip-text text-transparent",
  wash: "from-tier-pro-from/12 to-tier-pro-to/12",
};
const ENTERPRISE_CARD_RECIPE = {
  ring: "before:from-tier-enterprise-from before:to-tier-enterprise-to",
  text: "bg-linear-to-r from-tier-enterprise-from to-tier-enterprise-to bg-clip-text text-transparent",
  wash: "from-tier-enterprise-from/12 to-tier-enterprise-to/12",
};
export interface PlanCardRecipe {
  /** Gradient stops for the masked stroke ring, `before:`-scoped. */
  ring: string;
  /** The tier gradient clipped into name and price text. */
  text: string;
  /** The tier gradient at 12% — pair with a `bg-linear-to-*` direction. */
  wash: string;
}
const PLAN_CARD_RECIPES: Record<string, PlanCardRecipe> = {
  ENTERPRISE: ENTERPRISE_CARD_RECIPE,
  HOBBY: {
    ring: "before:from-tier-hobby-from before:to-tier-hobby-to",
    text: "bg-linear-to-r from-tier-hobby-from to-tier-hobby-to bg-clip-text text-transparent",
    wash: "from-tier-hobby-from/12 to-tier-hobby-to/12",
  },
  PLUS: ENTERPRISE_CARD_RECIPE,
  PRO: PRO_CARD_RECIPE,
  STANDARD: PRO_CARD_RECIPE,
  TEAM: {
    ring: "before:from-tier-team-from before:to-tier-team-to",
    text: "bg-linear-to-r from-tier-team-from to-tier-team-to bg-clip-text text-transparent",
    wash: "from-tier-team-from/12 to-tier-team-to/12",
  },
};

export function planCardRecipe(planName: string): PlanCardRecipe | null {
  return PLAN_CARD_RECIPES[planName.trim().toUpperCase()] ?? null;
}

const CHECK_GRADIENT_ID = "billing-pricing-check-gradient";

/** Stroke class wiring a CircleCheck to the shared svg gradient below. */
export const PLAN_CHECK_STROKE =
  "[stroke:url(#billing-pricing-check-gradient)]";

/**
 * The svg gradient behind every plan-card spec check. Render once per surface
 * that shows `BillingPlanCard`s (the Pricing catalog and the plan-change
 * select stage share the id, so duplicates stay harmless).
 */
export function PlanCheckGradientDefs() {
  return (
    <svg aria-hidden="true" className="absolute size-0">
      <linearGradient id={CHECK_GRADIENT_ID} x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="var(--color-zinc-50)" />
        <stop offset="1" stopColor="var(--color-blue-500)" />
      </linearGradient>
    </svg>
  );
}

export interface BillingPlanCardState {
  changeKind: "contact" | "downgrade" | "subscribe" | "upgrade" | null;
  inDebt: boolean;
  isBlockedByPendingUpgrade: boolean;
  isCurrent: boolean;
  isPendingDowngradeTarget: boolean;
  isPendingUpgradeTarget: boolean;
}

function PlanCardSpec({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      <CircleCheck
        aria-hidden
        className={cn("size-5 shrink-0", PLAN_CHECK_STROKE)}
        strokeWidth={1.75}
      />
      <span>{children}</span>
    </li>
  );
}

export function BillingPlanCard({
  action,
  currency,
  gpuEnabled,
  mostPopular,
  plan,
}: {
  action: ReactNode;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  mostPopular: boolean;
  plan: NormalizedBillingPlan;
}) {
  const recipe = PLAN_CARD_RECIPES[plan.name.trim().toUpperCase()];
  const resources = plan.resources.filter(
    (resource) => gpuEnabled || resource.type !== "gpu"
  );
  const features = planFeatures(plan.name);
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-1 flex-col gap-5 rounded-xl border bg-input/30 px-7 pt-6 pb-10 shadow-xs",
        recipe == null
          ? "border-border"
          : cn(
              "border-transparent bg-linear-to-br",
              "before:pointer-events-none before:absolute before:-inset-px before:rounded-[inherit] before:bg-linear-to-b before:p-px before:content-[''] before:[mask:linear-gradient(#000_0_0)_content-box_exclude,linear-gradient(#000_0_0)]",
              recipe.wash,
              recipe.ring
            )
      )}
    >
      {mostPopular ? (
        <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-brand-primary px-2 py-1 font-medium text-brand-primary-foreground text-xs">
          Most Popular
        </span>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3
          className={cn(
            "font-semibold text-xl",
            recipe == null ? "text-foreground" : recipe.text
          )}
        >
          {plan.name}
        </h3>
        <p className="min-h-15 text-muted-foreground text-sm">
          {plan.description}
        </p>
      </div>
      {/* One line — strikethrough original, price, then the /mo shorthand —
          kept small enough that a discounted price still fits the card. */}
      <div className="flex items-end gap-x-1.5 tabular-nums">
        {plan.monthlyOriginalPriceMicroUnits > 0 ? (
          <span className="font-medium text-foreground/50 text-lg leading-none line-through">
            {formatBillingAmount(plan.monthlyOriginalPriceMicroUnits, currency)}
          </span>
        ) : null}
        <span
          className={cn(
            "font-semibold text-3xl leading-none",
            recipe == null ? "text-foreground" : recipe.text
          )}
        >
          {formatBillingAmount(plan.monthlyPriceMicroUnits, currency)}
        </span>
        <span className="text-muted-foreground text-sm">/mo</span>
      </div>
      {action}
      <ul className="flex flex-col gap-3 text-sm">
        {resources.map((resource) => (
          <PlanCardSpec key={`${resource.type}-${resource.label}`}>
            {resource.value} {resource.label}
          </PlanCardSpec>
        ))}
        {features.map((feature) => (
          <PlanCardSpec key={feature}>{feature}</PlanCardSpec>
        ))}
      </ul>
    </article>
  );
}

export function planCardAction({
  className,
  onSelectPlan,
  plan,
  planStates,
  planStatesPending,
}: {
  className?: string;
  onSelectPlan?: (planId: string) => void;
  plan: NormalizedBillingPlan;
  planStates?: ReadonlyMap<string, BillingPlanCardState>;
  planStatesPending: boolean;
}): ReactNode {
  if (planStates == null) {
    return planStatesPending ? (
      <Skeleton className={cn("h-9 w-full", className)} />
    ) : null;
  }
  const state = planStates.get(plan.id);
  if (state == null) {
    return null;
  }
  if (state.isPendingUpgradeTarget) {
    return (
      <AppButton
        className={cn("w-full", className)}
        onClick={() => onSelectPlan?.(plan.id)}
      >
        Recover payment
      </AppButton>
    );
  }
  // Mirrors the legacy costcenter card rules: debt turns the current plan
  // into a clickable Renew, a plan already scheduled by a pending downgrade
  // is locked, Enterprise-outside-the-lists routes to sales, and everything
  // else is actionable with its transition label.
  if (state.isCurrent) {
    if (state.inDebt) {
      return (
        <AppButton
          className={cn("w-full", className)}
          onClick={() => onSelectPlan?.(plan.id)}
        >
          Renew
        </AppButton>
      );
    }
    return (
      <AppButton className={cn("w-full", className)} disabled>
        Your current plan
      </AppButton>
    );
  }
  if (state.isBlockedByPendingUpgrade) {
    return (
      <AppButton className={cn("w-full", className)} disabled>
        Payment in progress
      </AppButton>
    );
  }
  if (state.isPendingDowngradeTarget) {
    return (
      <AppButton className={cn("w-full", className)} disabled>
        Starts next cycle
      </AppButton>
    );
  }
  if (!state.inDebt && state.changeKind === "contact") {
    return (
      <AppButton className={cn("w-full", className)} disabled>
        Contact us
      </AppButton>
    );
  }
  const label = state.inDebt
    ? "Subscribe"
    : {
        contact: "Subscribe",
        downgrade: "Downgrade",
        subscribe: "Subscribe",
        upgrade: "Upgrade",
      }[state.changeKind ?? "upgrade"];
  return (
    <AppButton
      className={cn("w-full", className)}
      onClick={() => onSelectPlan?.(plan.id)}
    >
      {label}
    </AppButton>
  );
}

const PLAN_FEATURES = [
  {
    match: "standard",
    values: ["Priority Support", "All Hobby Features", "99.99% SLA"],
  },
  {
    match: "pro",
    values: [
      "24/7 Dedicated Support",
      "All Standard Features",
      "Custom Contracts",
    ],
  },
] as const;

export function planFeatures(planName: string): readonly string[] {
  const normalizedName = planName.toLowerCase();
  return (
    PLAN_FEATURES.find(({ match }) => normalizedName.includes(match))?.values ??
    []
  );
}
