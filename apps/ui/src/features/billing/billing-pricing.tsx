"use client";

import { AppSelect } from "@workspace/ui/components/app-select";
import { Badge } from "@workspace/ui/components/badge";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { useAtomValue } from "jotai";
import {
  Bot,
  Boxes,
  CircleCheck,
  CircuitBoard,
  Cpu,
  HardDrive,
  HdmiPort,
  type LucideIcon,
  MemoryStick,
  Network,
  Users,
} from "lucide-react";
import { useId, useState } from "react";
import useSWR from "swr";

import {
  formatBillingAmount,
  formatPreciseBillingAmount,
} from "@/features/billing/billing-amount";
import type { BillingPlanResourceType } from "@/features/billing/billing-plan-catalog";
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

const PRICE_ICONS = {
  cpu: Cpu,
  gpu: CircuitBoard,
  memory: MemoryStick,
  network: Network,
  nodeport: HdmiPort,
  storage: HardDrive,
  traffic: Network,
} satisfies Record<BillingPriceType, LucideIcon>;

const PLAN_RESOURCE_ICONS = {
  ...PRICE_ICONS,
  ai: Bot,
  other: Boxes,
  seats: Users,
} satisfies Record<BillingPlanResourceType, LucideIcon>;

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
  plans,
}: {
  currency: BillingCurrency;
  gpuEnabled: boolean;
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

  return (
    <section className="pb-8" data-slot="billing-pricing-plan-catalog">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-foreground text-lg">
            Subscription plan catalog
          </h2>
          <p className="text-muted-foreground text-sm">
            Monthly workspace plans
          </p>
        </div>
        <Badge variant="outline">Monthly</Badge>
      </div>
      {plans.length === 0 ? (
        <div className="border-border border-y py-12 text-center text-muted-foreground text-sm">
          No subscription plans are available.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mainPlans.map((plan, index) => {
              const resources = plan.resources.filter(
                (resource) => gpuEnabled || resource.type !== "gpu"
              );
              const features = planFeatures(plan.name);
              return (
                <article
                  className="relative flex min-h-64 flex-col rounded-md border border-border bg-card p-5 shadow-xs"
                  key={plan.id}
                >
                  {index === 1 ? (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                      Most popular
                    </Badge>
                  ) : null}
                  <div className="min-w-0">
                    <h3 className="font-semibold text-foreground text-lg">
                      {plan.name}
                    </h3>
                    <p className="mt-1 min-h-10 text-muted-foreground text-sm">
                      {plan.description}
                    </p>
                  </div>
                  <div className="mt-5 flex flex-wrap items-baseline gap-x-2 tabular-nums">
                    {plan.monthlyOriginalPriceMicroUnits > 0 ? (
                      <span className="text-muted-foreground line-through">
                        {formatBillingAmount(
                          plan.monthlyOriginalPriceMicroUnits,
                          currency
                        )}
                      </span>
                    ) : null}
                    <p className="font-semibold text-2xl text-foreground">
                      {formatBillingAmount(
                        plan.monthlyPriceMicroUnits,
                        currency
                      )}
                      <span className="font-normal text-muted-foreground text-sm">
                        /month
                      </span>
                    </p>
                  </div>
                  <ul className="mt-5 flex flex-col gap-2 text-sm">
                    {resources.map((resource) => {
                      const Icon = PLAN_RESOURCE_ICONS[resource.type];
                      return (
                        <li
                          className="flex items-center gap-2 text-muted-foreground"
                          key={`${resource.type}-${resource.label}`}
                        >
                          <Icon
                            aria-hidden
                            className="size-4 shrink-0 text-primary"
                            strokeWidth={1.75}
                          />
                          <span>
                            {resource.value} {resource.label}
                          </span>
                        </li>
                      );
                    })}
                    {features.map((feature) => (
                      <li
                        className="flex items-center gap-2 text-muted-foreground"
                        key={feature}
                      >
                        <CircleCheck
                          aria-hidden
                          className="size-4 shrink-0 text-primary"
                          strokeWidth={1.75}
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
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
                      className="min-w-0 rounded-md border border-border bg-card p-4"
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
  onCycleChange,
  prices,
}: {
  currency: BillingCurrency;
  cycleIndex: number;
  gpuEnabled: boolean;
  onCycleChange?: (cycleIndex: number) => void;
  prices: BillingMeteredPrice[];
}) {
  const cycle = PRICING_CYCLES[cycleIndex] ?? PRICING_CYCLES[0];
  const rows = prices.filter((price) => gpuEnabled || price.type !== "gpu");
  return (
    <TableLayout data-slot="billing-price-table">
      <TableLayoutCaption className="flex-col gap-3 sm:flex-row">
        <div>
          <h2 className="font-medium text-foreground">Metered prices</h2>
          <p className="text-muted-foreground text-xs">
            Base rates for usage-based workspaces
          </p>
        </div>
        <AppSelect
          aria-label="Billing cycle"
          className="w-full sm:w-40"
          onValueChange={(value) => onCycleChange?.(Number(value))}
          options={PRICING_CYCLES.map((item, index) => ({
            label: `Per ${item.label.toLowerCase()}`,
            value: String(index),
          }))}
          value={String(cycleIndex)}
        />
      </TableLayoutCaption>
      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead>Resource</TableHead>
          <TableHead>Unit</TableHead>
          <TableHead className="text-right">Price</TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="h-28 text-center text-muted-foreground"
                colSpan={3}
              >
                No metered prices are available.
              </TableCell>
            </TableRow>
          ) : (
            rows.map((price) => {
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
                      <span className="font-medium">{price.label}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {price.billingBasis === "quantity"
                      ? `per ${price.unit}`
                      : `per ${price.unit} / ${cycle.label.toLowerCase()}`}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatPreciseBillingAmount(
                      cyclePrice(price, cycleIndex),
                      currency
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableLayoutBody>
      </TableLayoutContent>
    </TableLayout>
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
  const idPrefix = useId();
  const gpuPrices = prices.filter((price) => price.type === "gpu");
  const [selectedGpu, setSelectedGpu] = useState(
    gpuPrices[0]?.sourceName ?? ""
  );
  const [duration, setDuration] = useState(1);
  const [durationUnit, setDurationUnit] = useState(0);
  const [workloads, setWorkloads] = useState(1);
  const [quantities, setQuantities] = useState<
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
    const amount = price.hourlyPriceMicroUnits * quantities[price.type];
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
    timedMicroUnits += (gpuPrice?.hourlyPriceMicroUnits ?? 0) * quantities.gpu;
  }
  const estimatedMicroUnits =
    timedMicroUnits * workloads * duration * cycle.hours + meteredMicroUnits;

  const updateQuantity = (type: BillingPriceType, value: number) => {
    setQuantities((current) => ({ ...current, [type]: value }));
  };

  return (
    <section
      className="rounded-md border border-border bg-card"
      data-slot="billing-price-calculator"
    >
      <div className="flex flex-col gap-1 border-border border-b bg-muted/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-medium text-foreground">Price estimate</h2>
          <p className="text-muted-foreground text-sm">
            Usage-based workspace estimate
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-muted-foreground text-xs">Estimated total</p>
          <p className="font-semibold text-2xl text-foreground tabular-nums">
            {formatPreciseBillingAmount(estimatedMicroUnits, currency)}
          </p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2">
        <div className="border-border p-5 lg:border-r">
          <h3 className="mb-4 font-medium text-foreground text-sm">
            Resources
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {visiblePrices.map((price) => {
              const Icon = PRICE_ICONS[price.type];
              const inputId = `${idPrefix}-${price.sourceName}`;
              return (
                <label
                  className="flex min-w-0 flex-col gap-1.5"
                  htmlFor={inputId}
                  key={price.sourceName}
                >
                  <span className="flex items-center gap-2 text-foreground text-sm">
                    <Icon
                      aria-hidden
                      className="size-4 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    {price.label}
                  </span>
                  <div className="relative">
                    <Input
                      aria-label={price.label}
                      className="pr-16 tabular-nums"
                      id={inputId}
                      min={0}
                      onChange={(event) =>
                        updateQuantity(
                          price.type,
                          Math.max(0, Number(event.target.value) || 0)
                        )
                      }
                      step="any"
                      type="number"
                      value={quantities[price.type]}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground text-xs">
                      {price.unit}
                    </span>
                  </div>
                </label>
              );
            })}

            {gpuEnabled && gpuPrices.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
                <span className="flex items-center gap-2 text-foreground text-sm">
                  <CircuitBoard
                    aria-hidden
                    className="size-4 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  GPU
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <AppSelect
                    aria-label="GPU model"
                    onValueChange={setSelectedGpu}
                    options={gpuPrices.map((price) => ({
                      label: price.label,
                      value: price.sourceName,
                    }))}
                    value={selectedGpu}
                  />
                  <div className="relative">
                    <Input
                      aria-label="GPU count"
                      className="pr-14 tabular-nums"
                      min={0}
                      onChange={(event) =>
                        updateQuantity(
                          "gpu",
                          Math.max(0, Number(event.target.value) || 0)
                        )
                      }
                      step={1}
                      type="number"
                      value={quantities.gpu}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground text-xs">
                      GPU
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-border border-t p-5 lg:border-t-0">
          <h3 className="mb-4 font-medium text-foreground text-sm">Usage</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="flex flex-col gap-1.5"
              htmlFor={`${idPrefix}-workloads`}
            >
              <span className="text-foreground text-sm">Workloads</span>
              <Input
                id={`${idPrefix}-workloads`}
                min={0}
                onChange={(event) =>
                  setWorkloads(Math.max(0, Number(event.target.value) || 0))
                }
                step={1}
                type="number"
                value={workloads}
              />
            </label>
            <label
              className="flex flex-col gap-1.5"
              htmlFor={`${idPrefix}-duration`}
            >
              <span className="text-foreground text-sm">Duration</span>
              <Input
                id={`${idPrefix}-duration`}
                min={0}
                onChange={(event) =>
                  setDuration(Math.max(0, Number(event.target.value) || 0))
                }
                step="any"
                type="number"
                value={duration}
              />
            </label>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-foreground text-sm">Duration unit</span>
              <AppSelect
                aria-label="Duration unit"
                onValueChange={(value) => setDurationUnit(Number(value))}
                options={PRICING_CYCLES.map((item, index) => ({
                  label: item.label,
                  value: String(index),
                }))}
                value={String(durationUnit)}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

interface BillingPricingSurfaceProps {
  currency: BillingCurrency;
  error?: unknown;
  gpuEnabled: boolean;
  isLoading?: boolean;
  snapshot?: BillingPricingSnapshot;
}

export function BillingPricingSurface({
  currency,
  error,
  gpuEnabled,
  isLoading = false,
  snapshot,
}: BillingPricingSurfaceProps) {
  const [cycleIndex, setCycleIndex] = useState(0);

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
    <Tabs className="flex flex-col gap-5" defaultValue="plans">
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
      </TabsList>

      <TabsContent
        className="data-[state=inactive]:hidden"
        forceMount
        value="plans"
      >
        <BillingPlanCatalog
          currency={currency}
          gpuEnabled={gpuEnabled}
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
              onCycleChange={setCycleIndex}
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
  const { data, error, isLoading } = useSWR(
    credentialsReady
      ? ["billing-pricing", workspace, appToken, kubeconfig]
      : null,
    () => loadBillingPricing({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  return (
    <BillingPricingSurface
      currency={currency}
      error={error}
      gpuEnabled={gpuEnabled}
      isLoading={!credentialsReady || isLoading}
      snapshot={data}
    />
  );
}
