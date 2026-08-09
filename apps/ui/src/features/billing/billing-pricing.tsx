"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppSelect } from "@workspace/ui/components/app-select";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import {
  Boxes,
  CircleCheck,
  CircuitBoard,
  Clock3,
  Cpu,
  HardDrive,
  HdmiPort,
  type LucideIcon,
  MemoryStick,
  Minus,
  Network,
  Plus,
} from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import useSWR from "swr";

import {
  billingCurrencySymbol,
  formatBillingAmount,
  formatPreciseBillingAmount,
  formatPreciseBillingNumber,
} from "@/features/billing/billing-amount";
import { BillingPlanChangeDialog } from "@/features/billing/billing-plan-change-dialog";
import { loadBillingPlanSnapshot } from "@/features/billing/billing-plan-data";
import {
  type BillingMeteredPrice,
  type BillingPriceType,
  type BillingPricingPlan,
  type BillingPricingSnapshot,
  loadBillingPricing,
} from "@/features/billing/billing-pricing-data";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";
import { errorDescription } from "@/lib/toast-utils";

export const PRICING_CYCLES = [
  { hours: 1, label: "Hour" },
  { hours: 24, label: "Day" },
  { hours: 168, label: "Week" },
  { hours: 720, label: "Month" },
  { hours: 8760, label: "Year" },
] as const;

const PRICING_CYCLE_OPTIONS = PRICING_CYCLES.map((cycle, index) => ({
  label: cycle.label,
  value: String(index),
}));

const PRICE_ICONS = {
  cpu: Cpu,
  gpu: CircuitBoard,
  memory: MemoryStick,
  network: Network,
  nodeport: HdmiPort,
  storage: HardDrive,
  traffic: Network,
} satisfies Record<BillingPriceType, LucideIcon>;

// Brain V2.0 pricing-card recipe: the tier gradient as a solid border (first
// stop), a 12% wash across the face, and the full gradient clipped into the
// name and price. Shares PlanBadge's palette aliases (STANDARD borrows PRO,
// PLUS borrows ENTERPRISE); names without a recipe — Starter included, per the
// pricing design — keep the neutral card.
const PRO_CARD_RECIPE = {
  card: "border-tier-pro-from bg-linear-to-br from-tier-pro-from/12 to-tier-pro-to/12",
  text: "bg-linear-to-r from-tier-pro-from to-tier-pro-to bg-clip-text text-transparent",
};
const ENTERPRISE_CARD_RECIPE = {
  card: "border-tier-enterprise-from bg-linear-to-br from-tier-enterprise-from/12 to-tier-enterprise-to/12",
  text: "bg-linear-to-r from-tier-enterprise-from to-tier-enterprise-to bg-clip-text text-transparent",
};
const PLAN_CARD_RECIPES: Record<string, { card: string; text: string }> = {
  ENTERPRISE: ENTERPRISE_CARD_RECIPE,
  FREE: {
    card: "border-tier-free-from bg-linear-to-br from-tier-free-from/12 to-tier-free-to/12",
    text: "bg-linear-to-r from-tier-free-from to-tier-free-to bg-clip-text text-transparent",
  },
  HOBBY: {
    card: "border-tier-hobby-from bg-linear-to-br from-tier-hobby-from/12 to-tier-hobby-to/12",
    text: "bg-linear-to-r from-tier-hobby-from to-tier-hobby-to bg-clip-text text-transparent",
  },
  PLUS: ENTERPRISE_CARD_RECIPE,
  PRO: PRO_CARD_RECIPE,
  STANDARD: PRO_CARD_RECIPE,
  TEAM: {
    card: "border-tier-team-from bg-linear-to-br from-tier-team-from/12 to-tier-team-to/12",
    text: "bg-linear-to-r from-tier-team-from to-tier-team-to bg-clip-text text-transparent",
  },
};

const CHECK_GRADIENT_ID = "billing-pricing-check-gradient";

interface BillingPlanCardState {
  changeKind: "downgrade" | "upgrade" | null;
  isCurrent: boolean;
}

function PlanCardSpec({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-muted-foreground">
      <CircleCheck
        aria-hidden
        className="size-5 shrink-0 [stroke:url(#billing-pricing-check-gradient)]"
        strokeWidth={1.75}
      />
      <span>{children}</span>
    </li>
  );
}

function BillingPlanCard({
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
  plan: BillingPricingPlan;
}) {
  const recipe = PLAN_CARD_RECIPES[plan.name.trim().toUpperCase()];
  const resources = plan.resources.filter(
    (resource) => gpuEnabled || resource.type !== "gpu"
  );
  const features = planFeatures(plan.name);
  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-1 flex-col gap-5 rounded-xl border bg-white/5 px-7 pt-6 pb-10 shadow-xs",
        recipe == null ? "border-border" : recipe.card
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
      <div className="flex flex-wrap items-end gap-x-1 tabular-nums">
        {plan.monthlyOriginalPriceMicroUnits > 0 ? (
          <span className="font-semibold text-3xl text-foreground/50 leading-none line-through">
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
        <span className="text-muted-foreground text-sm">/month</span>
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

function planCardAction({
  onSelectPlan,
  plan,
  planStates,
  planStatesPending,
}: {
  onSelectPlan?: (planId: string) => void;
  plan: BillingPricingPlan;
  planStates?: ReadonlyMap<string, BillingPlanCardState>;
  planStatesPending: boolean;
}): ReactNode {
  if (planStates == null) {
    return planStatesPending ? <Skeleton className="h-9 w-full" /> : null;
  }
  const state = planStates.get(plan.id);
  if (state == null) {
    return null;
  }
  if (state.isCurrent) {
    return (
      <AppButton className="w-full" disabled>
        Your current plan
      </AppButton>
    );
  }
  return (
    <AppButton className="w-full" onClick={() => onSelectPlan?.(plan.id)}>
      {state.changeKind === "downgrade" ? "Downgrade" : "Upgrade"}
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

function planFeatures(planName: string): readonly string[] {
  const normalizedName = planName.toLowerCase();
  return (
    PLAN_FEATURES.find(({ match }) => normalizedName.includes(match))?.values ??
    []
  );
}

export function BillingPlanCatalog({
  currency,
  gpuEnabled,
  onSelectPlan,
  planStates,
  planStatesPending = false,
  plans,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
  onSelectPlan?: (planId: string) => void;
  planStates?: ReadonlyMap<string, BillingPlanCardState>;
  planStatesPending?: boolean;
  plans: BillingPricingPlan[];
}) {
  const mainPlans = plans
    .filter((plan) => !plan.tags.includes("more"))
    .slice()
    .sort((left, right) => left.order - right.order);
  const additionalPlans = plans
    .filter((plan) => plan.tags.includes("more") && plan.name !== "Customized")
    .slice()
    .sort((left, right) => left.order - right.order)
    .slice(0, 2);
  const standardIndex = mainPlans.findIndex(
    (plan) => plan.name.trim().toUpperCase() === "STANDARD"
  );
  const mostPopularIndex = standardIndex === -1 ? 1 : standardIndex;

  return (
    <section className="pb-8" data-slot="billing-pricing-plan-catalog">
      <svg aria-hidden="true" className="absolute size-0">
        <linearGradient id={CHECK_GRADIENT_ID} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-zinc-50)" />
          <stop offset="1" stopColor="var(--color-blue-500)" />
        </linearGradient>
      </svg>
      <h2 className="mb-4 font-medium text-foreground text-lg">
        Choose Your Workspace Plan
      </h2>
      {plans.length === 0 ? (
        <div className="border-border border-y py-12 text-center text-muted-foreground text-sm">
          No subscription plans are available.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3 lg:flex-row">
            {mainPlans.map((plan, index) => (
              <BillingPlanCard
                action={planCardAction({
                  onSelectPlan,
                  plan,
                  planStates,
                  planStatesPending,
                })}
                currency={currency}
                gpuEnabled={gpuEnabled}
                key={plan.id}
                mostPopular={index === mostPopularIndex}
                plan={plan}
              />
            ))}
          </div>

          {additionalPlans.length > 0 ? (
            <div>
              <h3 className="mb-3 font-medium text-foreground">More plans</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {additionalPlans.map((plan) => {
                  const resourceSummary = plan.resources
                    .filter((resource) => gpuEnabled || resource.type !== "gpu")
                    .map((resource) => `${resource.value} ${resource.label}`);
                  const details = [
                    ...resourceSummary,
                    ...planFeatures(plan.name),
                  ].join(" + ");
                  return (
                    <article
                      className="min-w-0 rounded-xl border border-border bg-white/5 p-4"
                      key={plan.id}
                    >
                      <h4 className="font-medium text-foreground text-sm">
                        {plan.name}
                      </h4>
                      <p className="mt-1 break-words text-muted-foreground text-xs">
                        {details} -{" "}
                        {formatBillingAmount(
                          plan.primaryPriceMicroUnits,
                          currency
                        )}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function cyclePrice(price: BillingMeteredPrice, cycleIndex: number): number {
  const cycle = PRICING_CYCLES[cycleIndex] ?? PRICING_CYCLES[0];
  return (
    price.hourlyPriceMicroUnits *
    (price.billingBasis === "quantity" ? 1 : cycle.hours)
  );
}

export function BillingPriceTable({
  currency,
  cycleIndex,
  gpuEnabled,
  prices,
}: {
  currency: BillingCurrency;
  cycleIndex: number;
  gpuEnabled: boolean;
  prices: BillingMeteredPrice[];
}) {
  const cycle = PRICING_CYCLES[cycleIndex] ?? PRICING_CYCLES[0];
  const rows = prices.filter((price) => gpuEnabled || price.type !== "gpu");
  const sections = [
    {
      rows: rows.filter(
        (price) => price.type !== "gpu" && price.billingBasis === "duration"
      ),
      title: "Basic Pricing",
    },
    {
      rows: rows.filter((price) => price.billingBasis === "quantity"),
      title: "Network Pricing",
    },
    {
      rows: rows.filter((price) => price.type === "gpu"),
      title: "GPU Price Table",
    },
  ].filter((section) => section.rows.length > 0);

  return (
    <TableLayout data-slot="billing-price-table">
      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead className="h-14">Name</TableHead>
          <TableHead className="h-14">Unit</TableHead>
          <TableHead className="h-14">
            Price ({billingCurrencySymbol(currency)})
          </TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          {sections.length === 0 ? (
            <TableRow>
              <TableCell
                className="h-28 text-center text-muted-foreground"
                colSpan={3}
              >
                No metered prices are available.
              </TableCell>
            </TableRow>
          ) : (
            sections.map((section) => (
              <Fragment key={section.title}>
                <TableRow className="bg-white/5 hover:bg-white/5">
                  <TableCell className="h-12 font-medium" colSpan={3}>
                    {section.title}
                  </TableCell>
                </TableRow>
                {section.rows.map((price) => {
                  const Icon = PRICE_ICONS[price.type];
                  return (
                    <TableRow key={price.sourceName}>
                      <TableCell className="h-14">
                        <div className="flex items-center gap-2.5">
                          <Icon
                            aria-hidden
                            className="size-4 text-muted-foreground"
                            strokeWidth={1.75}
                          />
                          <span>{price.label}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {price.billingBasis === "quantity"
                          ? `/${price.unit}`
                          : `${price.unit} / ${cycle.label}`}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatPreciseBillingNumber(
                          cyclePrice(price, cycleIndex)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </Fragment>
            ))
          )}
        </TableLayoutBody>
      </TableLayoutContent>
    </TableLayout>
  );
}

const CALCULATOR_SLIDER_STOPS: Partial<
  Record<BillingPriceType, readonly number[]>
> = {
  cpu: [1, 8, 16, 24, 32],
  memory: [1, 16, 32, 64, 128],
};

function sliderStopIndex(value: number, stops: readonly number[]): number {
  let stopIndex = 0;
  for (let index = 0; index < stops.length; index += 1) {
    if ((stops[index] ?? 0) <= value) {
      stopIndex = index;
    }
  }
  return stopIndex;
}

function sliderMarkAlignment(index: number, lastIndex: number): string {
  if (index === 0) {
    return "translate-x-0";
  }
  if (index === lastIndex) {
    return "-translate-x-full";
  }
  return "-translate-x-1/2";
}

function CalculatorStopsSlider({
  ariaLabel,
  onValueChange,
  stops,
  unit,
  value,
}: {
  ariaLabel: string;
  onValueChange: (value: number) => void;
  stops: readonly number[];
  unit: string;
  value: number;
}) {
  const lastIndex = stops.length - 1;
  return (
    <SettingsSlider.Root
      max={lastIndex}
      min={0}
      onValueChange={(index) => onValueChange(stops[index] ?? stops[0] ?? 0)}
      step={1}
      value={sliderStopIndex(value, stops)}
    >
      <div className="w-56 min-w-0 max-w-full lg:w-96">
        <SettingsSlider.Control aria-label={ariaLabel}>
          <SettingsSlider.Track>
            <SettingsSlider.Range />
          </SettingsSlider.Track>
          <SettingsSlider.Thumb />
        </SettingsSlider.Control>
        <div className="relative mt-1.5 h-4 text-muted-foreground text-xs">
          {stops.map((stop, index) => (
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap",
                sliderMarkAlignment(index, lastIndex)
              )}
              key={stop}
              style={{ left: `${(index / lastIndex) * 100}%` }}
            >
              {stop}
              {index === lastIndex ? ` ${unit}` : ""}
            </span>
          ))}
        </div>
      </div>
    </SettingsSlider.Root>
  );
}

function CalculatorNumberInput({
  ariaLabel,
  max = Number.MAX_SAFE_INTEGER,
  onValueChange,
  unit,
  value,
}: {
  ariaLabel: string;
  max?: number;
  onValueChange: (value: number) => void;
  unit?: string;
  value: number;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(0, next));
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative w-44">
        <Button
          aria-label={`Decrease ${ariaLabel}`}
          className="absolute inset-y-px left-px z-10 h-auto w-9 rounded-r-none border-border border-r"
          disabled={value <= 0}
          onClick={() => onValueChange(clamp(value - 1))}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Minus aria-hidden className="size-4" />
        </Button>
        <Input
          aria-label={ariaLabel}
          className="px-10 text-center tabular-nums"
          max={max}
          min={0}
          onChange={(event) =>
            onValueChange(clamp(Number(event.target.value) || 0))
          }
          step="any"
          type="number"
          value={value}
        />
        <Button
          aria-label={`Increase ${ariaLabel}`}
          className="absolute inset-y-px right-px z-10 h-auto w-9 rounded-l-none border-border border-l"
          disabled={value >= max}
          onClick={() => onValueChange(clamp(value + 1))}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus aria-hidden className="size-4" />
        </Button>
      </div>
      {unit ? (
        <span className="text-muted-foreground text-sm">{unit}</span>
      ) : null}
    </div>
  );
}

function CalculatorRow({
  children,
  className,
  icon: Icon,
  label,
}: {
  children: ReactNode;
  className?: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-y-3">
      <span className="flex w-44 shrink-0 items-center gap-2 text-foreground text-sm">
        <Icon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
        />
        {label}
      </span>
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-5 gap-y-3",
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}

function CalculatorSectionBar({ title }: { title: string }) {
  return (
    <h3 className="border-border border-y bg-white/5 px-5 py-3.5 font-medium text-foreground text-sm">
      {title}
    </h3>
  );
}

export function BillingCalculator({
  currency,
  gpuEnabled,
  prices,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
  prices: BillingMeteredPrice[];
}) {
  const gpuPrices = prices.filter((price) => price.type === "gpu");
  const [selectedGpu, setSelectedGpu] = useState(
    gpuPrices[0]?.sourceName ?? ""
  );
  const [duration, setDuration] = useState(1);
  const [durationUnit, setDurationUnit] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [resourceQuantities, setResourceQuantities] = useState<
    Record<BillingPriceType, number>
  >({
    cpu: 1,
    gpu: 0,
    memory: 1,
    network: 0,
    nodeport: 0,
    storage: 0,
    traffic: 0,
  });
  const visiblePrices: BillingMeteredPrice[] = [];
  const seenTypes = new Set<BillingPriceType>();
  for (const price of prices) {
    if (price.type === "gpu" || seenTypes.has(price.type)) {
      continue;
    }
    seenTypes.add(price.type);
    visiblePrices.push(price);
  }

  const cycle = PRICING_CYCLES[durationUnit] ?? PRICING_CYCLES[0];
  let timedMicroUnits = 0;
  let meteredMicroUnits = 0;
  for (const price of visiblePrices) {
    const amount = price.hourlyPriceMicroUnits * resourceQuantities[price.type];
    if (price.billingBasis === "quantity") {
      meteredMicroUnits += amount;
    } else {
      timedMicroUnits += amount;
    }
  }
  if (gpuEnabled) {
    const gpuPrice = gpuPrices.find(
      (price) => price.sourceName === selectedGpu
    );
    timedMicroUnits +=
      (gpuPrice?.hourlyPriceMicroUnits ?? 0) * resourceQuantities.gpu;
  }
  const estimatedMicroUnits =
    timedMicroUnits * quantity * duration * cycle.hours + meteredMicroUnits;

  const updateResourceQuantity = (type: BillingPriceType, value: number) => {
    setResourceQuantities((current) => ({ ...current, [type]: value }));
  };

  const rowEntries: (BillingMeteredPrice | "gpu")[] = [...visiblePrices];
  if (gpuEnabled && gpuPrices.length > 0) {
    const nodeportIndex = rowEntries.findIndex(
      (entry) => entry !== "gpu" && entry.type === "nodeport"
    );
    rowEntries.splice(
      nodeportIndex === -1 ? rowEntries.length : nodeportIndex,
      0,
      "gpu"
    );
  }

  return (
    <section
      className="overflow-hidden rounded-xl border border-border"
      data-slot="billing-price-calculator"
    >
      <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 bg-primary/5 px-5 py-4">
        <h2 className="font-semibold text-foreground text-xl">Total Amount:</h2>
        <p className="font-semibold text-primary text-xl tabular-nums">
          {formatPreciseBillingAmount(estimatedMicroUnits, currency)}
        </p>
      </div>

      <CalculatorSectionBar title="Resources" />
      <div className="flex flex-col gap-8 px-6 py-6">
        {rowEntries.map((entry) => {
          if (entry === "gpu") {
            return (
              <CalculatorRow icon={CircuitBoard} key="gpu" label="GPU">
                <AppSelect
                  aria-label="GPU model"
                  className="w-56"
                  onValueChange={setSelectedGpu}
                  options={gpuPrices.map((price) => ({
                    label: price.label,
                    value: price.sourceName,
                  }))}
                  value={selectedGpu}
                />
                <CalculatorNumberInput
                  ariaLabel="GPU count"
                  onValueChange={(value) =>
                    updateResourceQuantity("gpu", value)
                  }
                  unit="GPU"
                  value={resourceQuantities.gpu}
                />
              </CalculatorRow>
            );
          }
          const Icon = PRICE_ICONS[entry.type];
          const sliderStops = CALCULATOR_SLIDER_STOPS[entry.type];
          return (
            <CalculatorRow
              className="gap-10"
              icon={Icon}
              key={entry.sourceName}
              label={entry.label}
            >
              {sliderStops ? (
                <CalculatorStopsSlider
                  ariaLabel={`${entry.label} slider`}
                  onValueChange={(value) =>
                    updateResourceQuantity(entry.type, value)
                  }
                  stops={sliderStops}
                  unit={entry.unit}
                  value={resourceQuantities[entry.type]}
                />
              ) : null}
              <CalculatorNumberInput
                ariaLabel={entry.label}
                onValueChange={(value) =>
                  updateResourceQuantity(entry.type, value)
                }
                unit={entry.unit}
                value={resourceQuantities[entry.type]}
              />
            </CalculatorRow>
          );
        })}
      </div>

      <CalculatorSectionBar title="Usage" />
      <div className="flex flex-col gap-8 px-6 py-6">
        <CalculatorRow icon={Boxes} label="Quantity">
          <CalculatorNumberInput
            ariaLabel="Quantity"
            max={1000}
            onValueChange={setQuantity}
            value={quantity}
          />
        </CalculatorRow>
        <CalculatorRow icon={Clock3} label="Duration">
          <CalculatorNumberInput
            ariaLabel="Duration"
            max={1_000_000}
            onValueChange={setDuration}
            value={duration}
          />
          <AppSelect
            aria-label="Duration unit"
            className="w-28"
            onValueChange={(value) => setDurationUnit(Number(value))}
            options={PRICING_CYCLE_OPTIONS}
            value={String(durationUnit)}
          />
        </CalculatorRow>
      </div>
    </section>
  );
}

interface BillingPricingSurfaceProps {
  currency: BillingCurrency;
  error?: unknown;
  gpuEnabled: boolean;
  isLoading?: boolean;
  onSelectPlan?: (planId: string) => void;
  planStates?: ReadonlyMap<string, BillingPlanCardState>;
  planStatesPending?: boolean;
  snapshot?: BillingPricingSnapshot;
}

export function BillingPricingSurface({
  currency,
  error,
  gpuEnabled,
  isLoading = false,
  onSelectPlan,
  planStates,
  planStatesPending = false,
  snapshot,
}: BillingPricingSurfaceProps) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [view, setView] = useState("plans");

  if (isLoading || snapshot == null) {
    return error == null ? (
      <div
        aria-label="Loading pricing"
        className="flex flex-col gap-4"
        role="status"
      >
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-72 w-full" />
      </div>
    ) : (
      <div className="py-16 text-center" role="alert">
        <p className="font-medium text-foreground">Pricing is unavailable.</p>
        <p className="mt-1 text-muted-foreground text-sm">
          {errorDescription(error, "The billing service could not be reached.")}
        </p>
      </div>
    );
  }

  return (
    <Tabs className="flex flex-col gap-5" onValueChange={setView} value={view}>
      <TabsList aria-label="Pricing views">
        <TabsTrigger className="min-h-11" value="plans">
          Subscription plans
        </TabsTrigger>
        {snapshot.isPayg ? (
          <>
            <TabsTrigger className="min-h-11" value="table">
              Price table
            </TabsTrigger>
            <TabsTrigger className="min-h-11" value="calculator">
              Price calculator
            </TabsTrigger>
          </>
        ) : null}
        {snapshot.isPayg && view === "table" ? (
          <div className="ml-auto pb-1 pl-3">
            <AppSelect
              aria-label="Billing cycle"
              className="w-28"
              onValueChange={(value) => setCycleIndex(Number(value))}
              options={PRICING_CYCLE_OPTIONS}
              value={String(cycleIndex)}
            />
          </div>
        ) : null}
      </TabsList>

      <TabsContent
        className="data-[state=inactive]:hidden"
        forceMount
        value="plans"
      >
        <BillingPlanCatalog
          currency={currency}
          gpuEnabled={gpuEnabled}
          onSelectPlan={onSelectPlan}
          planStates={planStates}
          planStatesPending={planStatesPending}
          plans={snapshot.plans}
        />
      </TabsContent>
      {snapshot.isPayg ? (
        <>
          <TabsContent
            className="data-[state=inactive]:hidden"
            forceMount
            value="table"
          >
            <BillingPriceTable
              currency={currency}
              cycleIndex={cycleIndex}
              gpuEnabled={gpuEnabled}
              prices={snapshot.prices}
            />
          </TabsContent>
          <TabsContent
            className="data-[state=inactive]:hidden"
            forceMount
            value="calculator"
          >
            <BillingCalculator
              currency={currency}
              gpuEnabled={gpuEnabled}
              prices={snapshot.prices}
            />
          </TabsContent>
        </>
      ) : null}
    </Tabs>
  );
}

export default function BillingPricing({
  currency,
  gpuEnabled,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
}) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken.trim() !== "" && kubeconfig.trim() !== "" && workspace !== "";
  const {
    data,
    error,
    isLoading,
    mutate: refreshPricing,
  } = useSWR(
    credentialsReady
      ? ["billing-pricing", workspace, appToken, kubeconfig]
      : null,
    () => loadBillingPricing({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const {
    data: planSnapshot,
    isLoading: planSnapshotLoading,
    mutate: refreshPlanSnapshot,
  } = useSWR(
    credentialsReady
      ? (["billing-plan-snapshot", workspace, kubeconfig, appToken] as const)
      : null,
    () => loadBillingPlanSnapshot({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const planStates = useMemo(() => {
    if (planSnapshot?.current.canManage !== true) {
      return;
    }
    return new Map(
      planSnapshot.plans.map((plan) => [
        plan.id,
        { changeKind: plan.changeKind ?? null, isCurrent: plan.isCurrent },
      ])
    );
  }, [planSnapshot]);

  return (
    <>
      <BillingPricingSurface
        currency={currency}
        error={error}
        gpuEnabled={gpuEnabled}
        isLoading={!credentialsReady || isLoading}
        onSelectPlan={(planId) => {
          setSelectedPlanId(planId);
          setPlanDialogOpen(true);
        }}
        planStates={planStates}
        planStatesPending={planSnapshotLoading}
        snapshot={data}
      />
      {planSnapshot == null ? null : (
        <BillingPlanChangeDialog
          credentials={{ appToken, kubeconfig }}
          currency={currency}
          onOpenChange={(open) => {
            setPlanDialogOpen(open);
            if (!open) {
              setSelectedPlanId(null);
            }
          }}
          onSelectedPlanChange={setSelectedPlanId}
          onSubscriptionChanged={async () => {
            await Promise.all([refreshPlanSnapshot(), refreshPricing()]);
          }}
          open={planDialogOpen}
          selectedPlanId={selectedPlanId}
          snapshot={planSnapshot}
        />
      )}
    </>
  );
}
