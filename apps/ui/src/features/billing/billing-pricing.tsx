"use client";

import { AppSelect } from "@workspace/ui/components/app-select";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  SlidingToggle,
  type SlidingToggleOption,
} from "@workspace/ui/components/sliding-toggle";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import {
  Boxes,
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
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import {
  billingCurrencySymbol,
  formatPreciseBillingAmount,
  formatPreciseBillingNumber,
} from "@/features/billing/billing-amount";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import {
  type BillingPlanChangeServices,
  BillingPlanCheckoutDialog,
  planOperator,
} from "@/features/billing/billing-plan-checkout-dialog";
import {
  BillingPlanCongratulationsDialog,
  useSettledPaymentCongratulations,
} from "@/features/billing/billing-plan-congratulations-dialog";
import {
  type BillingPlanSnapshot,
  loadBillingPlanSnapshot,
  subscriptionLifecycleAllowsBillingActions,
} from "@/features/billing/billing-plan-data";
import { BillingPlanPicker } from "@/features/billing/billing-plan-picker";
import {
  type BillingMeteredPrice,
  type BillingPriceType,
  type BillingPricingSnapshot,
  loadBillingPricing,
} from "@/features/billing/billing-pricing-data";
import { settleSubscriptionChange } from "@/features/billing/billing-subscription-settlement";
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

// The Pricing plans area is the Plan Picker — the same surface the Plan
// view's plan-change dialog renders — fed by the plan snapshot rather than
// the pricing catalog, so the two never drift apart.
export function BillingPlanCatalogSection({
  currency,
  gpuEnabled,
  onSelectPlan,
  planSnapshot,
  planSnapshotError,
  planSnapshotLoading = false,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
  onSelectPlan?: (planId: string) => void;
  planSnapshot?: BillingPlanSnapshot | null;
  planSnapshotError?: unknown;
  planSnapshotLoading?: boolean;
}) {
  let content: ReactNode;
  if (planSnapshot != null) {
    content = (
      <BillingPlanPicker
        actionable={
          planSnapshot.current.canManage &&
          subscriptionLifecycleAllowsBillingActions(
            planSnapshot.current.lifecycle
          )
        }
        currency={currency}
        gpuEnabled={gpuEnabled}
        inDebt={planSnapshot.current.lifecycle === "payment-due"}
        onOpenUrl={(url) => {
          window.open(url, "_blank", "noopener,noreferrer");
        }}
        onSelectPlan={onSelectPlan}
        pendingDowngradePlanName={
          planSnapshot.pendingDowngrade?.planName ?? null
        }
        pendingUpgradePlanName={planSnapshot.pendingUpgrade?.planName ?? null}
        plans={planSnapshot.plans}
      />
    );
  } else if (planSnapshotLoading) {
    content = (
      <div
        aria-label="Loading subscription plans"
        className="flex flex-col gap-3"
        role="status"
      >
        <Skeleton className="h-80 w-full" />
      </div>
    );
  } else {
    content = (
      <div className="py-16 text-center" role="alert">
        <p className="font-medium text-foreground">
          Subscription plans are unavailable.
        </p>
        <p className="mt-1 text-muted-foreground text-sm">
          {errorDescription(
            planSnapshotError,
            "The billing service could not be reached."
          )}
        </p>
      </div>
    );
  }

  return (
    <section className="pb-8" data-slot="billing-pricing-plan-catalog">
      <h2 className="mb-4 font-medium text-foreground text-lg">
        Choose Your Workspace Plan
      </h2>
      {content}
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
                <TableRow className="bg-muted hover:bg-muted dark:bg-white/5 dark:hover:bg-white/5">
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
    <h3 className="border-border border-y bg-muted px-5 py-3.5 font-medium text-foreground text-sm dark:bg-white/5">
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

type BillingPricingView = "plans" | "table" | "calculator";

const PRICING_VIEW_OPTIONS = {
  plans: { label: "Subscription plans", value: "plans" },
  table: { label: "Price table", value: "table" },
  calculator: { label: "Price calculator", value: "calculator" },
} as const satisfies Record<
  BillingPricingView,
  SlidingToggleOption<BillingPricingView>
>;

function pricingViewOptions(
  isPayg: boolean
): readonly SlidingToggleOption<BillingPricingView>[] {
  if (isPayg) {
    return [
      PRICING_VIEW_OPTIONS.plans,
      PRICING_VIEW_OPTIONS.table,
      PRICING_VIEW_OPTIONS.calculator,
    ];
  }
  return [PRICING_VIEW_OPTIONS.plans];
}

interface BillingPricingSurfaceProps {
  currency: BillingCurrency;
  error?: unknown;
  gpuEnabled: boolean;
  isLoading?: boolean;
  onSelectPlan?: (planId: string) => void;
  planSnapshot?: BillingPlanSnapshot | null;
  planSnapshotError?: unknown;
  planSnapshotLoading?: boolean;
  snapshot?: BillingPricingSnapshot;
}

export function BillingPricingSurface({
  currency,
  error,
  gpuEnabled,
  isLoading = false,
  onSelectPlan,
  planSnapshot,
  planSnapshotError,
  planSnapshotLoading = false,
  snapshot,
}: BillingPricingSurfaceProps) {
  const [cycleIndex, setCycleIndex] = useState(0);
  const [view, setView] = useState<BillingPricingView>("plans");

  if (isLoading || snapshot == null) {
    return error == null ? (
      <div
        aria-label="Loading pricing"
        className="flex flex-col gap-4"
        role="status"
      >
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

  const viewOptions = pricingViewOptions(snapshot.isPayg);
  const activeView = viewOptions.some((option) => option.value === view)
    ? view
    : "plans";
  const showSwitcher = viewOptions.length > 1;

  return (
    <div className="flex flex-col gap-5" data-slot="billing-pricing-surface">
      {showSwitcher ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SlidingToggle
            ariaLabel="Pricing views"
            className="w-fit border border-border bg-transparent"
            indicatorClassName="rounded-[calc(var(--radius-lg)-1px)]"
            itemClassName="!px-4 text-muted-foreground hover:text-muted-foreground aria-pressed:text-foreground aria-pressed:hover:text-foreground"
            onValueChange={setView}
            options={viewOptions}
            segments="fit"
            value={activeView}
            width="auto"
          />
          {activeView === "table" ? (
            <AppSelect
              aria-label="Billing cycle"
              className="w-28"
              onValueChange={(value) => setCycleIndex(Number(value))}
              options={PRICING_CYCLE_OPTIONS}
              value={String(cycleIndex)}
            />
          ) : null}
        </div>
      ) : null}

      {/* Keep inactive panels mounted so calculator inputs survive view switches. */}
      <div className={activeView === "plans" ? undefined : "hidden"}>
        <BillingPlanCatalogSection
          currency={currency}
          gpuEnabled={gpuEnabled}
          onSelectPlan={onSelectPlan}
          planSnapshot={planSnapshot}
          planSnapshotError={planSnapshotError}
          planSnapshotLoading={planSnapshotLoading}
        />
      </div>
      {snapshot.isPayg ? (
        <>
          <div className={activeView === "table" ? undefined : "hidden"}>
            <BillingPriceTable
              currency={currency}
              cycleIndex={cycleIndex}
              gpuEnabled={gpuEnabled}
              prices={snapshot.prices}
            />
          </div>
          <div className={activeView === "calculator" ? undefined : "hidden"}>
            <BillingCalculator
              currency={currency}
              gpuEnabled={gpuEnabled}
              prices={snapshot.prices}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

interface BillingPricingCheckoutProps {
  credentials: BillingCredentials;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  onClearSelection: () => void;
  /**
   * Refreshes the page's data and resolves with the new subscription, or
   * `null` when the refresh produced none — never rejects, because the
   * checkout's poll reads a rejection as "keep waiting".
   */
  onSubscriptionChanged: () => Promise<BillingPlanSnapshot | null>;
  planSnapshot: BillingPlanSnapshot;
  /** Injected by tests; production uses the checkout dialog's own defaults. */
  schedulePoll?: (callback: () => void, delay: number) => () => void;
  selectedPlanId: string | null;
  services?: BillingPlanChangeServices;
}

/**
 * The Pricing page's plans area is itself the Plan Picker, so a card's
 * Upgrade/Downgrade opens the checkout dialog alone — no picker dialog
 * stacked underneath. A settled payment ends in the same congratulations
 * dialog the Plan view shows, so the entry point never changes the ending.
 */
export function BillingPricingCheckout({
  credentials,
  currency,
  gpuEnabled,
  onClearSelection,
  onSubscriptionChanged,
  planSnapshot,
  schedulePoll,
  selectedPlanId,
  services,
}: BillingPricingCheckoutProps) {
  const congratulations = useSettledPaymentCongratulations();
  // No memo: the result is a reference into `planSnapshot.plans`, never a new
  // object, so the checkout dialog below sees a stable `plan` for as long as
  // the snapshot itself is stable.
  const candidatePlan =
    planSnapshot.plans.find((entry) => entry.id === selectedPlanId) ?? null;
  const inDebt = planSnapshot.current.lifecycle === "payment-due";
  // A pending upgrade never blocks selection: picking a conflicting plan
  // still opens checkout, whose quote request 409s into the recovery stage.
  const selectedPlan =
    planOperator(candidatePlan, inDebt) == null ? null : candidatePlan;

  return (
    <>
      <BillingPlanCheckoutDialog
        credentials={credentials}
        currency={currency}
        gpuEnabled={gpuEnabled}
        onClose={onClearSelection}
        onDismiss={onClearSelection}
        onPaymentSuccess={congratulations.onPaymentSuccess}
        onSubscriptionChanged={async () => {
          congratulations.recordSettledSnapshot(await onSubscriptionChanged());
        }}
        open={selectedPlan != null}
        plan={selectedPlan}
        schedulePoll={schedulePoll}
        services={services}
        snapshot={planSnapshot}
      />
      <BillingPlanCongratulationsDialog
        chargedMicroUnits={congratulations.chargedMicroUnits}
        currency={currency}
        onClose={congratulations.dismiss}
        snapshot={congratulations.snapshot}
      />
    </>
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
    error: planSnapshotError,
    isLoading: planSnapshotLoading,
    mutate: refreshPlanSnapshot,
  } = useSWR(
    credentialsReady
      ? (["billing-plan-snapshot", workspace, kubeconfig, appToken] as const)
      : null,
    () => loadBillingPlanSnapshot({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const settlementCancelRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      settlementCancelRef.current?.();
    },
    []
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  return (
    <>
      <BillingPricingSurface
        currency={currency}
        error={error}
        gpuEnabled={gpuEnabled}
        isLoading={!credentialsReady || isLoading}
        onSelectPlan={setSelectedPlanId}
        planSnapshot={planSnapshot}
        planSnapshotError={planSnapshotError}
        planSnapshotLoading={!credentialsReady || planSnapshotLoading}
        snapshot={data}
      />
      {planSnapshot == null ? null : (
        <BillingPricingCheckout
          credentials={{ appToken, kubeconfig }}
          currency={currency}
          gpuEnabled={gpuEnabled}
          onClearSelection={() => setSelectedPlanId(null)}
          onSubscriptionChanged={async () => {
            const [nextSnapshot] = await Promise.all([
              refreshPlanSnapshot(),
              refreshPricing(),
            ]);
            // No AI Credits are shown on this page, but the Plan view reads
            // the same global caches — settle them so returning there does
            // not present pre-payment values.
            settlementCancelRef.current?.();
            settlementCancelRef.current = settleSubscriptionChange({
              appToken,
              currency,
              kubeconfig,
              workspace,
            });
            return nextSnapshot ?? null;
          }}
          planSnapshot={planSnapshot}
          selectedPlanId={selectedPlanId}
        />
      )}
    </>
  );
}
