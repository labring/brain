"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Pagination } from "@workspace/ui/components/pagination";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutFooter,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircle, Boxes, Check, ChevronDown } from "lucide-react";
import { type ReactNode, useId, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { SelectedBillingApp } from "@/features/billing/billing-app-cost-drawer";
import { BillingCostCharts } from "@/features/billing/billing-cost-charts";
import {
  type BillingCostScope,
  type BillingCostsSnapshot,
  buildDailyCostTrend,
  buildMonthlyBillingTrend,
  buildWorkspaceCostBreakdown,
  isPaidSubscriptionPayment,
  resolveBillingAppType,
  type SubscriptionPayment,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

const APP_PAGE_SIZE = 10;
// The old Cost Center rendered subscription rows as "2026/07/01 10:14".
const SUBSCRIPTION_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const TIME_RANGE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
});
const CONSUMPTION_ROW_KEYS = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
  "row-6",
  "row-7",
  "row-8",
  "row-9",
  "row-10",
];
const EMPTY_SNAPSHOT: BillingCostsSnapshot = {
  appOverviews: [],
  appTypes: {},
  costPoints: [],
  payments: [],
  region: null,
  totalAppOverviewPages: 1,
  totalAppOverviews: 0,
  totalConsumptionMicroUnits: 0,
  workspaceConsumptionMicroUnits: {},
  workspaces: [],
};

interface BillingCostsSurfaceProps {
  appPage: number;
  appTypeFilter: string | null;
  currency: BillingCurrency;
  dateFilter: ReactNode;
  dateRange: { endTime: string; startTime: string };
  error: unknown;
  isLoading: boolean;
  onAppPageChange?: (page: number) => void;
  onAppTypeFilterChange?: (appType: string | null) => void;
  onScopeChange?: (scope: BillingCostScope) => void;
  onSelectApp?: (app: SelectedBillingApp) => void;
  scope: BillingCostScope;
  snapshot?: BillingCostsSnapshot;
}

interface ConsumptionRow {
  amount: number;
  appName: string;
  appType: number;
  key: string;
  namespace: string;
  queryAppType: string;
  typeName: string;
  workspaceName: string;
}

function workspaceName(
  workspaces: Map<string, string>,
  workspace: string
): string {
  return (workspaces.get(workspace) ?? workspace) || "Account";
}

function scopeCostTitle(
  scope: BillingCostScope,
  regionLabel: string,
  workspaceLabel: string
): string {
  if (scope.kind === "region") {
    return `${regionLabel} Cost`;
  }
  if (scope.kind === "workspace") {
    return `${regionLabel} / ${workspaceLabel} Cost`;
  }
  return "Total Cost";
}

function LoadingTableRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      <TableCell colSpan={columns}>
        <Skeleton className="h-12 w-full" />
      </TableCell>
    </TableRow>
  );
}

function EmptyTableRow({ columns }: { columns: number }) {
  return (
    <TableRow>
      <TableCell
        className="h-24 text-center text-muted-foreground"
        colSpan={columns}
      >
        No Data Available
      </TableCell>
    </TableRow>
  );
}

/** The dotted canvas backdrop behind the old /billing cost tree. */
function DotGridBackdrop() {
  const patternId = useId();
  return (
    <svg
      aria-hidden="true"
      className="absolute inset-0 size-full text-muted-foreground/50"
    >
      <pattern
        height="40"
        id={patternId}
        patternUnits="userSpaceOnUse"
        width="40"
      >
        <circle cx="16" cy="16" fill="currentColor" r="0.75" />
      </pattern>
      <rect fill={`url(#${patternId})`} height="100%" width="100%" />
    </svg>
  );
}

function CostScopeCard({
  cost,
  currency,
  isLoading,
  name,
  onClick,
  selected,
}: {
  cost: number;
  currency: BillingCurrency;
  isLoading: boolean;
  name: string;
  onClick?: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        "flex w-40 flex-col items-start gap-1 rounded-xl border border-muted-foreground/50 border-dashed bg-card p-3 text-left shadow-xs transition-colors hover:border-brand-primary",
        selected && "border-2 border-brand-primary border-solid"
      )}
      data-slot="billing-cost-scope-card"
      onClick={onClick}
      type="button"
    >
      <span
        className="w-full truncate text-muted-foreground text-sm"
        title={name}
      >
        {name}
      </span>
      {isLoading ? (
        <Skeleton className="h-6 w-16" />
      ) : (
        <span
          className={cn(
            "font-bold tabular-nums",
            selected ? "text-brand-primary" : "text-foreground"
          )}
        >
          {formatBillingAmount(cost, currency)}
        </span>
      )}
    </button>
  );
}

/** Indented tree level with the old dashed elbow connectors. */
function CostTreeChildren({
  items,
}: {
  items: Array<{ key: string; node: ReactNode; selected: boolean }>;
}) {
  const lastIndex = items.length - 1;
  return (
    <ul className="ml-5 flex flex-col">
      {items.map((item, index) => (
        <li className="relative pt-3 pl-8" key={item.key}>
          <span
            aria-hidden
            className={cn(
              "absolute top-0 left-0 h-12 w-6 rounded-bl-xl border-b border-l",
              item.selected
                ? "border-brand-primary"
                : "border-muted-foreground/40 border-dashed"
            )}
          />
          {index === lastIndex ? null : (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 border-muted-foreground/40 border-l border-dashed"
            />
          )}
          {item.node}
        </li>
      ))}
    </ul>
  );
}

function SubscriptionCostTable({
  currency,
  isLoading,
  payments,
}: {
  currency: BillingCurrency;
  isLoading: boolean;
  payments: SubscriptionPayment[];
}) {
  return (
    <TableLayout>
      <TableLayoutCaption>
        <span className="font-medium">Subscription</span>
      </TableLayoutCaption>
      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead className="w-1/3">Time</TableHead>
          <TableHead className="w-1/3">Plan</TableHead>
          <TableHead className="w-1/3">Cost</TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          {isLoading ? <LoadingTableRow columns={3} /> : null}
          {!isLoading && payments.length === 0 ? (
            <EmptyTableRow columns={3} />
          ) : null}
          {isLoading
            ? null
            : payments.map((payment) => (
                <TableRow key={payment.ID}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {SUBSCRIPTION_TIME_FORMATTER.format(new Date(payment.Time))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {payment.PlanName || "Subscription"}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBillingAmount(payment.Amount, currency)}
                  </TableCell>
                </TableRow>
              ))}
        </TableLayoutBody>
      </TableLayoutContent>
    </TableLayout>
  );
}

function AppTypeFilterOption({
  checked,
  label,
  onSelect,
}: {
  checked: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={checked}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-popover-foreground text-sm hover:bg-muted",
        checked && "font-medium"
      )}
      onClick={onSelect}
      type="button"
    >
      <Check
        aria-hidden
        className={cn("size-4 shrink-0", checked ? "" : "invisible")}
      />
      {label}
    </button>
  );
}

/** The old Type column-header filter: All types + each AppType. */
function AppTypeFilter({
  appTypeFilter,
  appTypeOptions,
  onAppTypeFilterChange,
}: {
  appTypeFilter: string | null;
  appTypeOptions: string[];
  onAppTypeFilterChange?: (appType: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectOption = (appType: string | null) => {
    onAppTypeFilterChange?.(appType);
    setOpen(false);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className="flex cursor-pointer items-center gap-1"
        type="button"
      >
        Type
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4",
            appTypeFilter == null
              ? "text-muted-foreground"
              : "text-brand-primary"
          )}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-48 gap-0 p-1">
        <span className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
          Type
        </span>
        <AppTypeFilterOption
          checked={appTypeFilter == null}
          label="All types"
          onSelect={() => selectOption(null)}
        />
        {appTypeOptions.map((appType) => (
          <AppTypeFilterOption
            checked={appTypeFilter === appType}
            key={appType}
            label={appType}
            onSelect={() => selectOption(appType)}
          />
        ))}
      </PopoverContent>
    </Popover>
  );
}

function ConsumptionCostTable({
  appPage,
  appTypeFilter,
  appTypeOptions,
  currency,
  isLoading,
  onAppPageChange,
  onAppTypeFilterChange,
  onSelectRow,
  rows,
  timeRangeLabel,
  totalCount,
  totalPages,
}: {
  appPage: number;
  appTypeFilter: string | null;
  appTypeOptions: string[];
  currency: BillingCurrency;
  isLoading: boolean;
  onAppPageChange?: (page: number) => void;
  onAppTypeFilterChange?: (appType: string | null) => void;
  onSelectRow?: (row: ConsumptionRow) => void;
  rows: ConsumptionRow[];
  timeRangeLabel: string;
  totalCount: number;
  totalPages: number;
}) {
  return (
    <TableLayout>
      <TableLayoutCaption>
        <div className="flex items-center gap-3">
          <span className="font-medium">PAYG</span>
          <span className="text-muted-foreground">{timeRangeLabel}</span>
        </div>
      </TableLayoutCaption>
      <TableLayoutContent>
        <TableLayoutHeadRow>
          <TableHead className="w-48">Item</TableHead>
          <TableHead className="w-40">
            <AppTypeFilter
              appTypeFilter={appTypeFilter}
              appTypeOptions={appTypeOptions}
              onAppTypeFilterChange={onAppTypeFilterChange}
            />
          </TableHead>
          <TableHead className="w-32">Cost</TableHead>
          <TableHead>Action</TableHead>
        </TableLayoutHeadRow>
        <TableLayoutBody>
          {isLoading
            ? CONSUMPTION_ROW_KEYS.map((key) => (
                <TableRow className="h-12" key={`skeleton-${key}`}>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            : null}
          {!isLoading && rows.length === 0 ? (
            <EmptyTableRow columns={4} />
          ) : null}
          {isLoading
            ? null
            : rows.map((row) => (
                <TableRow className="h-12" key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Boxes
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span
                        className="max-w-32 truncate font-medium"
                        title={row.appName || row.typeName}
                      >
                        {row.appName || row.typeName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{row.typeName}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBillingAmount(row.amount, currency)}
                  </TableCell>
                  <TableCell>
                    <Button
                      onClick={() => onSelectRow?.(row)}
                      size="sm"
                      variant="outline"
                    >
                      Usage
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          {!isLoading && rows.length > 0
            ? CONSUMPTION_ROW_KEYS.slice(rows.length).map((key) => (
                <TableRow
                  aria-hidden
                  className="h-12 border-none hover:bg-transparent"
                  key={`placeholder-${key}`}
                >
                  <TableCell colSpan={4} />
                </TableRow>
              ))
            : null}
        </TableLayoutBody>
      </TableLayoutContent>
      <TableLayoutFooter>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            Total: {isLoading ? <Skeleton className="h-4 w-8" /> : totalCount}
          </div>
          <div className="flex items-center gap-3">
            <Pagination
              currentPage={appPage}
              onPageChange={(page) => onAppPageChange?.(page)}
              totalPages={totalPages}
            />
            <span>
              {APP_PAGE_SIZE}
              <span className="text-muted-foreground"> / Page</span>
            </span>
          </div>
        </div>
      </TableLayoutFooter>
    </TableLayout>
  );
}

export function BillingCostsSurface({
  appPage,
  appTypeFilter,
  currency,
  dateFilter,
  dateRange,
  error,
  isLoading,
  onAppPageChange,
  onAppTypeFilterChange,
  onScopeChange,
  onSelectApp,
  scope,
  snapshot = EMPTY_SNAPSHOT,
}: BillingCostsSurfaceProps) {
  const workspaceNames = new Map(snapshot.workspaces);
  const workspaceCosts = buildWorkspaceCostBreakdown(snapshot);
  const selectedWorkspace = scope.kind === "workspace" ? scope.workspace : null;
  const selectedCost = workspaceCosts.find(
    ({ id }) => id === selectedWorkspace
  );
  const scopedPayments = snapshot.payments.filter(
    (payment) =>
      isPaidSubscriptionPayment(payment) &&
      (selectedWorkspace == null || payment.Workspace === selectedWorkspace)
  );
  const subscriptionPayments = scopedPayments.filter(
    (payment) => payment.Type.toUpperCase() === "SUBSCRIPTION"
  );
  const monthlyTrend = buildMonthlyBillingTrend({
    costPoints: snapshot.costPoints,
    dateRange,
    payments: snapshot.payments,
  });
  const regionLabel =
    snapshot.region?.name?.en ?? snapshot.region?.domain ?? "Current region";
  const dailyTrend = buildDailyCostTrend({
    dateRange,
    regions: [{ costPoints: snapshot.costPoints, label: regionLabel }],
  });
  const consumptionRows = snapshot.appOverviews.map((app) => {
    const { queryAppType, typeName } = resolveBillingAppType(
      app.appType,
      snapshot.appTypes
    );
    return {
      amount: app.amount,
      appName: app.appName,
      appType: app.appType,
      key: `${app.namespace}-${app.appType}-${app.appName}`,
      namespace: app.namespace,
      queryAppType,
      typeName,
      workspaceName: workspaceName(workspaceNames, app.namespace),
    } satisfies ConsumptionRow;
  });
  const appTypeOptions = [...new Set(Object.values(snapshot.appTypes))];
  const workspaceLabel =
    selectedCost?.name ??
    (selectedWorkspace == null
      ? ""
      : workspaceName(workspaceNames, selectedWorkspace));
  const bannerTitle = scopeCostTitle(scope, regionLabel, workspaceLabel);
  const allSubscriptionMicroUnits = snapshot.payments
    .filter(
      (payment) =>
        isPaidSubscriptionPayment(payment) &&
        payment.Type.toUpperCase() === "SUBSCRIPTION"
    )
    .reduce((sum, payment) => sum + payment.Amount, 0);
  const regionCostMicroUnits =
    allSubscriptionMicroUnits + snapshot.totalConsumptionMicroUnits;
  const bannerCostMicroUnits =
    scope.kind === "workspace"
      ? (selectedCost?.totalMicroUnits ?? 0)
      : regionCostMicroUnits;
  const timeRangeLabel = `${TIME_RANGE_FORMATTER.format(
    new Date(dateRange.startTime)
  )} – ${TIME_RANGE_FORMATTER.format(new Date(dateRange.endTime))}`;
  const selectApp = (row: ConsumptionRow) => {
    onSelectApp?.({
      amount: row.amount,
      appName: row.appName,
      appType: row.appType,
      namespace: row.namespace,
      queryAppType: row.queryAppType,
      regionName: regionLabel,
      typeName: row.typeName,
      workspaceName: row.workspaceName,
    });
  };

  return (
    <div
      className="flex flex-col gap-6 pb-16"
      data-slot="billing-costs-surface"
    >
      {error == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Costs are unavailable</AlertTitle>
          <AlertDescription>
            Billing data could not be loaded for this period.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="details">
        <TabsList aria-label="Cost views">
          <TabsTrigger className="min-h-11" value="details">
            Billing
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="trends">
            Cost &amp; Top-up Trends
          </TabsTrigger>
        </TabsList>

        <TabsContent className="py-6" value="details">
          <div className="overflow-hidden rounded-2xl border border-border">
            <div className="border-border border-b px-4 py-3">{dateFilter}</div>
            <div className="flex flex-col lg:flex-row">
              <div className="relative min-h-96 flex-1 overflow-hidden bg-muted/20 p-5">
                <DotGridBackdrop />
                <p className="relative text-muted-foreground text-sm">
                  Select a card to view cost details
                </p>
                <div className="relative mt-5 flex flex-col items-start">
                  <CostScopeCard
                    cost={regionCostMicroUnits}
                    currency={currency}
                    isLoading={isLoading}
                    name="Total Cost"
                    onClick={() => onScopeChange?.({ kind: "total" })}
                    selected={scope.kind === "total"}
                  />
                  <CostTreeChildren
                    items={[
                      {
                        key: "region",
                        node: (
                          <>
                            <CostScopeCard
                              cost={regionCostMicroUnits}
                              currency={currency}
                              isLoading={isLoading}
                              name={regionLabel}
                              onClick={() =>
                                onScopeChange?.({ kind: "region" })
                              }
                              selected={scope.kind === "region"}
                            />
                            <CostTreeChildren
                              items={workspaceCosts.map((workspace) => ({
                                key: workspace.id,
                                node: (
                                  <CostScopeCard
                                    cost={workspace.totalMicroUnits}
                                    currency={currency}
                                    isLoading={isLoading}
                                    name={workspace.name}
                                    onClick={() =>
                                      onScopeChange?.({
                                        kind: "workspace",
                                        workspace: workspace.id,
                                      })
                                    }
                                    selected={
                                      selectedWorkspace === workspace.id
                                    }
                                  />
                                ),
                                selected: selectedWorkspace === workspace.id,
                              }))}
                            />
                          </>
                        ),
                        selected: scope.kind !== "total",
                      },
                    ]}
                  />
                </div>
              </div>

              <div className="flex w-full flex-col gap-4 border-border border-t p-4 lg:w-1/2 lg:border-t-0 lg:border-l">
                <div
                  className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-xl border border-border bg-brand-primary/10 p-4 text-sm shadow-xs backdrop-blur-sm"
                  data-slot="billing-cost-scope-banner"
                >
                  <div className="font-semibold">
                    <span>{bannerTitle}: </span>
                    <span className="text-brand-primary tabular-nums">
                      {isLoading
                        ? "…"
                        : formatBillingAmount(bannerCostMicroUnits, currency)}
                    </span>
                  </div>
                </div>

                <SubscriptionCostTable
                  currency={currency}
                  isLoading={isLoading}
                  payments={subscriptionPayments}
                />

                <ConsumptionCostTable
                  appPage={appPage}
                  appTypeFilter={appTypeFilter}
                  appTypeOptions={appTypeOptions}
                  currency={currency}
                  isLoading={isLoading}
                  onAppPageChange={onAppPageChange}
                  onAppTypeFilterChange={onAppTypeFilterChange}
                  onSelectRow={selectApp}
                  rows={consumptionRows}
                  timeRangeLabel={timeRangeLabel}
                  totalCount={snapshot.totalAppOverviews}
                  totalPages={snapshot.totalAppOverviewPages}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent className="py-6" value="trends">
          <BillingCostCharts
            currency={currency}
            daily={dailyTrend}
            monthly={monthlyTrend}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
