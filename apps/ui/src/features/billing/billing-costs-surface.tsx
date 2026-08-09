"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { AppButton } from "@workspace/ui/components/app-button";
import { Pagination } from "@workspace/ui/components/pagination";
import { AppTypeBadge, PlanBadge } from "@workspace/ui/components/plan-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  SlidingToggle,
  type SlidingToggleOption,
} from "@workspace/ui/components/sliding-toggle";
import { TableCell, TableHead, TableRow } from "@workspace/ui/components/table";
import {
  TableLayout,
  TableLayoutBody,
  TableLayoutCaption,
  TableLayoutContent,
  TableLayoutFooter,
  TableLayoutHeadRow,
} from "@workspace/ui/components/table-layout";
import { cn } from "@workspace/ui/lib/utils";
import { AlertCircle, Boxes, Check, ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { SelectedBillingApp } from "@/features/billing/billing-app-cost-drawer";
import { BillingCostCharts } from "@/features/billing/billing-cost-charts";
import { BillingCostTree } from "@/features/billing/billing-cost-tree";
import {
  type BillingCostScope,
  type BillingCostsSnapshot,
  buildWorkspaceCostBreakdown,
  type DailyCostTrend,
  isPaidSubscriptionPayment,
  type MonthlyBillingTrendPoint,
  resolveBillingAppType,
  type SubscriptionPayment,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

const APP_PAGE_SIZE = 10;

type BillingCostsView = "details" | "trends";
const COST_VIEW_OPTIONS = [
  { label: "Billing", value: "details" },
  { label: "Cost & Top-up Trends", value: "trends" },
] as const satisfies readonly SlidingToggleOption<BillingCostsView>[];
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
// The empty-plan default lives here, not in PlanBadge: "an unnamed payment is
// a Subscription" is billing knowledge, not badge styling.
function planBadgeLabel(planName: string): string {
  return planName.trim() === "" ? "Subscription" : planName;
}

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
  dailyTrend?: DailyCostTrend;
  dateFilter: ReactNode;
  dateRange: { endTime: string; startTime: string };
  error: unknown;
  isLoading: boolean;
  monthlyTrend?: MonthlyBillingTrendPoint[];
  onAppPageChange?: (page: number) => void;
  onAppTypeFilterChange?: (appType: string | null) => void;
  onScopeChange?: (scope: BillingCostScope) => void;
  onSelectApp?: (app: SelectedBillingApp) => void;
  scope: BillingCostScope;
  snapshot?: BillingCostsSnapshot;
  trendsError?: unknown;
  trendsLoading?: boolean;
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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** The V2.0 billing timestamp: `yyyy-MM-dd HH:mm` in local time. */
function formatBillingDateTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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
    <TableLayout className="rounded-r-none rounded-l-lg border-r-0 bg-card">
      <TableLayoutCaption className="h-12 py-0">
        <span className="font-semibold">Subscription</span>
      </TableLayoutCaption>
      <TableLayoutContent>
        <TableLayoutHeadRow className={{ thead: "h-10" }}>
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
                <TableRow className="h-14" key={payment.ID}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {formatBillingDateTime(payment.Time)}
                  </TableCell>
                  <TableCell>
                    <PlanBadge planName={planBadgeLabel(payment.PlanName)} />
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
    <TableLayout className="rounded-r-none rounded-l-lg border-r-0 bg-card">
      <TableLayoutCaption className="h-12 py-0">
        <div className="flex items-center gap-3">
          <span className="font-semibold">PAYG</span>
          <span className="text-muted-foreground">{timeRangeLabel}</span>
        </div>
      </TableLayoutCaption>
      <TableLayoutContent>
        <TableLayoutHeadRow className={{ thead: "h-10" }}>
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
                <TableRow className="h-14" key={`skeleton-${key}`}>
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
                <TableRow className="h-14" key={row.key}>
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
                    <AppTypeBadge>{row.typeName}</AppTypeBadge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatBillingAmount(row.amount, currency)}
                  </TableCell>
                  <TableCell>
                    <AppButton
                      onClick={() => onSelectRow?.(row)}
                      size="default"
                      variant="secondary"
                    >
                      Usage
                    </AppButton>
                  </TableCell>
                </TableRow>
              ))}
          {!isLoading && rows.length > 0
            ? CONSUMPTION_ROW_KEYS.slice(rows.length).map((key) => (
                <TableRow
                  aria-hidden
                  className="h-14 border-none hover:bg-transparent"
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
  dailyTrend,
  dateFilter,
  dateRange,
  error,
  isLoading,
  monthlyTrend,
  onAppPageChange,
  onAppTypeFilterChange,
  onScopeChange,
  onSelectApp,
  scope,
  snapshot = EMPTY_SNAPSHOT,
  trendsError = null,
  trendsLoading = false,
}: BillingCostsSurfaceProps) {
  const [view, setView] = useState<BillingCostsView>("details");
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
  const regionLabel =
    snapshot.region?.name?.en ?? snapshot.region?.domain ?? "Current region";
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
  const timeRangeLabel = `${formatBillingDateTime(
    dateRange.startTime
  )} – ${formatBillingDateTime(dateRange.endTime)}`;
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
    <div className="flex flex-col gap-6" data-slot="billing-costs-surface">
      {error == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Costs are unavailable</AlertTitle>
          <AlertDescription>
            Billing data could not be loaded for this period.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4">
        <SlidingToggle
          ariaLabel="Cost views"
          className="w-fit border border-border bg-transparent"
          indicatorClassName="rounded-[calc(var(--radius-lg)-1px)]"
          itemClassName="!px-4 text-muted-foreground hover:text-muted-foreground aria-pressed:text-foreground aria-pressed:hover:text-foreground"
          onValueChange={setView}
          options={COST_VIEW_OPTIONS}
          segments="fit"
          value={view}
          width="auto"
        />

        {view === "details" ? (
          /* Old Cost Center shell: the card fills the viewport below the
             billing chrome (52px header + 16px top padding + 38px switcher
             + 16px gap + 16px bottom padding). */
          <div className="flex h-[calc(100vh-138px)] min-h-96 flex-col overflow-hidden rounded-lg border border-border">
            <div className="flex h-17 shrink-0 items-center border-border border-b px-4">
              {dateFilter}
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <BillingCostTree
                currency={currency}
                isLoading={isLoading}
                onScopeChange={onScopeChange}
                regionCost={regionCostMicroUnits}
                regionLabel={regionLabel}
                scope={scope}
                workspaces={workspaceCosts.map((workspace) => ({
                  cost: workspace.totalMicroUnits,
                  id: workspace.id,
                  name: workspace.name,
                }))}
              />

              {/* The detail panel floats over the full-width canvas and
                  scrolls independently, as in the old Cost Center. */}
              <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-[clamp(22.5rem,50%,32rem)] overflow-y-auto">
                <div className="pointer-events-auto">
                  <div
                    className="sticky top-0 z-10 mb-4 flex h-14 items-center justify-between gap-4 rounded-bl-lg border-border border-b border-l bg-card bg-linear-to-b from-white/5 to-white/5 px-4 text-sm"
                    data-slot="billing-cost-scope-banner"
                  >
                    <div className="font-semibold">
                      <span>{bannerTitle}: </span>
                      <span className="text-blue-400 tabular-nums">
                        {isLoading
                          ? "…"
                          : formatBillingAmount(bannerCostMicroUnits, currency)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-4 pb-4">
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
            </div>
          </div>
        ) : (
          <div className="pb-16">
            <BillingCostCharts
              currency={currency}
              daily={dailyTrend}
              error={trendsError}
              isLoading={trendsLoading}
              monthly={monthlyTrend}
            />
          </div>
        )}
      </div>
    </div>
  );
}
