"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Pagination } from "@workspace/ui/components/pagination";
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
import {
  AlertCircle,
  Boxes,
  ChevronRight,
  Eye,
  Gauge,
  Globe2,
  Layers3,
  ReceiptText,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import type { SelectedBillingApp } from "@/features/billing/billing-app-cost-drawer";
import { BillingCostCharts } from "@/features/billing/billing-cost-charts";
import {
  type BillingCostsSnapshot,
  buildDailyCostTrend,
  buildMonthlyBillingTrend,
  buildWorkspaceCostBreakdown,
  isPaidSubscriptionPayment,
  resolveBillingAppType,
  subscriptionPaymentDescription,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

const APP_PAGE_SIZE = 10;
const PAYMENT_PAGE_SIZE = 10;
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
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
  currency: BillingCurrency;
  dateFilter: ReactNode;
  dateRange: { endTime: string; startTime: string };
  error: unknown;
  isLoading: boolean;
  onAppPageChange?: (page: number) => void;
  onSelectApp?: (app: SelectedBillingApp) => void;
  onSelectWorkspace?: (workspace: string | null) => void;
  selectedWorkspace: string | null;
  snapshot?: BillingCostsSnapshot;
}

function workspaceName(
  workspaces: Map<string, string>,
  workspace: string
): string {
  return (workspaces.get(workspace) ?? workspace) || "Account";
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

export function BillingCostsSurface({
  appPage,
  currency,
  dateFilter,
  dateRange,
  error,
  isLoading,
  onAppPageChange,
  onSelectApp,
  onSelectWorkspace,
  selectedWorkspace,
  snapshot = EMPTY_SNAPSHOT,
}: BillingCostsSurfaceProps) {
  const [paymentPage, setPaymentPage] = useState(1);
  const workspaceNames = new Map(snapshot.workspaces);
  const workspaceCosts = buildWorkspaceCostBreakdown(snapshot);
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
  const subscriptionMicroUnits = subscriptionPayments.reduce(
    (sum, payment) => sum + payment.Amount,
    0
  );
  const consumptionMicroUnits =
    selectedCost?.consumptionMicroUnits ??
    (selectedWorkspace == null ? snapshot.totalConsumptionMicroUnits : 0);
  const totalMicroUnits = subscriptionMicroUnits + consumptionMicroUnits;
  const paymentMicroUnits = scopedPayments.reduce(
    (sum, payment) => sum + payment.Amount,
    0
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
  const totalPaymentPages = Math.max(
    1,
    Math.ceil(scopedPayments.length / PAYMENT_PAGE_SIZE)
  );
  const visiblePaymentPage = Math.min(paymentPage, totalPaymentPages);
  const visiblePayments = scopedPayments.slice(
    (visiblePaymentPage - 1) * PAYMENT_PAGE_SIZE,
    visiblePaymentPage * PAYMENT_PAGE_SIZE
  );

  return (
    <div
      className="flex flex-col gap-6 pb-16"
      data-slot="billing-costs-surface"
    >
      <div className="flex flex-col gap-4 border-border border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-semibold text-2xl text-foreground">Costs</h1>
          <span className="text-muted-foreground text-sm">
            {selectedCost?.name ?? "All workspaces"}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <span className="font-medium text-foreground text-xs">
            Date range
          </span>
          {dateFilter}
        </div>
      </div>

      {error == null ? null : (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Costs are unavailable</AlertTitle>
          <AlertDescription>
            Billing data could not be loaded for this period.
          </AlertDescription>
        </Alert>
      )}

      <dl className="grid divide-y divide-border border-border border-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        {[
          ["Total cost", totalMicroUnits],
          ["Subscription", subscriptionMicroUnits],
          ["Consumption Cost", consumptionMicroUnits],
          ["Payments", paymentMicroUnits],
        ].map(([label, amount]) => (
          <div className="flex flex-col gap-1 px-4 py-4" key={label}>
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="font-semibold text-foreground text-xl tabular-nums">
              {isLoading ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                formatBillingAmount(amount as number, currency)
              )}
            </dd>
          </div>
        ))}
      </dl>

      <Tabs defaultValue="details">
        <TabsList aria-label="Cost views">
          <TabsTrigger className="min-h-11" value="details">
            Cost details
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="trends">
            Cost and payment trends
          </TabsTrigger>
          <TabsTrigger className="min-h-11" value="payments">
            Subscription Payments
          </TabsTrigger>
        </TabsList>

        <TabsContent className="py-6" value="details">
          <div className="grid min-h-96 gap-6 lg:grid-cols-4 lg:gap-0">
            <aside className="border-border border-b pb-6 lg:border-r lg:border-b-0 lg:pr-6">
              <div className="mb-3 flex items-center gap-2">
                <Layers3
                  aria-hidden
                  className="size-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <h2 className="font-medium text-foreground text-sm">
                  Cost scope
                </h2>
              </div>
              <div className="flex flex-col gap-1">
                <div className="mb-1 flex min-h-11 items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                  <Globe2
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {regionLabel}
                  </span>
                  <Badge variant="outline">Region</Badge>
                </div>
                <button
                  aria-pressed={selectedWorkspace == null}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                    selectedWorkspace == null && "bg-muted font-medium"
                  )}
                  onClick={() => onSelectWorkspace?.(null)}
                  type="button"
                >
                  <span className="truncate">All workspaces</span>
                  <ChevronRight aria-hidden className="size-4 shrink-0" />
                </button>
                {workspaceCosts.map((workspace) => (
                  <button
                    aria-pressed={selectedWorkspace === workspace.id}
                    className={cn(
                      "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                      selectedWorkspace === workspace.id &&
                        "bg-muted font-medium"
                    )}
                    key={workspace.id}
                    onClick={() => onSelectWorkspace?.(workspace.id)}
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {workspace.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {formatBillingAmount(workspace.totalMicroUnits, currency)}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="flex min-w-0 flex-col gap-8 lg:col-span-3 lg:pl-6">
              <TableLayout>
                <TableLayoutCaption>
                  <div className="flex items-center gap-2">
                    <ReceiptText aria-hidden className="size-4" />
                    <span className="font-medium">Subscription costs</span>
                  </div>
                  <Badge variant="outline">Plan fees</Badge>
                </TableLayoutCaption>
                <TableLayoutContent>
                  <TableLayoutHeadRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableLayoutHeadRow>
                  <TableLayoutBody>
                    {isLoading ? <LoadingTableRow columns={4} /> : null}
                    {!isLoading && subscriptionPayments.length === 0 ? (
                      <TableRow>
                        <TableCell
                          className="h-24 text-center text-muted-foreground"
                          colSpan={4}
                        >
                          No subscription costs in this period.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {isLoading
                      ? null
                      : subscriptionPayments.map((payment) => (
                          <TableRow key={payment.ID}>
                            <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                              {DATE_TIME_FORMATTER.format(
                                new Date(payment.Time)
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {payment.PlanName || "Subscription"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {workspaceName(workspaceNames, payment.Workspace)}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatBillingAmount(payment.Amount, currency)}
                            </TableCell>
                          </TableRow>
                        ))}
                  </TableLayoutBody>
                </TableLayoutContent>
              </TableLayout>

              <TableLayout>
                <TableLayoutCaption>
                  <div className="flex items-center gap-2">
                    <Gauge aria-hidden className="size-4" />
                    <span className="font-medium">Consumption Cost</span>
                  </div>
                  <Badge variant="secondary">Metered consumption</Badge>
                </TableLayoutCaption>
                <TableLayoutContent>
                  <TableLayoutHeadRow>
                    <TableHead>App</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Workspace</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableLayoutHeadRow>
                  <TableLayoutBody>
                    {isLoading ? <LoadingTableRow columns={5} /> : null}
                    {!isLoading && snapshot.appOverviews.length === 0 ? (
                      <TableRow>
                        <TableCell
                          className="h-24 text-center text-muted-foreground"
                          colSpan={5}
                        >
                          No Consumption Cost in this period.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {isLoading
                      ? null
                      : snapshot.appOverviews.map((app) => {
                          const { queryAppType, typeName } =
                            resolveBillingAppType(
                              app.appType,
                              snapshot.appTypes
                            );
                          const appWorkspaceName = workspaceName(
                            workspaceNames,
                            app.namespace
                          );
                          return (
                            <TableRow
                              key={`${app.namespace}-${app.appType}-${app.appName}`}
                            >
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <Boxes
                                    aria-hidden
                                    className="size-4 text-muted-foreground"
                                  />
                                  <span>{app.appName || typeName}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{typeName}</Badge>
                              </TableCell>
                              <TableCell>{appWorkspaceName}</TableCell>
                              <TableCell className="text-right font-medium tabular-nums">
                                {formatBillingAmount(app.amount, currency)}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  onClick={() =>
                                    onSelectApp?.({
                                      ...app,
                                      queryAppType,
                                      typeName,
                                      workspaceName: appWorkspaceName,
                                    })
                                  }
                                  size="sm"
                                  variant="outline"
                                >
                                  <Eye aria-hidden />
                                  View usage
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                  </TableLayoutBody>
                </TableLayoutContent>
                <TableLayoutFooter>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <span className="text-muted-foreground text-sm">
                      {snapshot.totalAppOverviews} apps
                    </span>
                    <div className="flex items-center gap-3">
                      <Pagination
                        currentPage={appPage}
                        onPageChange={(page) => onAppPageChange?.(page)}
                        totalPages={snapshot.totalAppOverviewPages}
                      />
                      <span className="text-muted-foreground text-xs">
                        {APP_PAGE_SIZE} / page
                      </span>
                    </div>
                  </div>
                </TableLayoutFooter>
              </TableLayout>
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

        <TabsContent className="py-6" value="payments">
          <TableLayout>
            <TableLayoutCaption>
              <span className="font-medium">Subscription Payments</span>
              <Badge variant="secondary">Paid</Badge>
            </TableLayoutCaption>
            <TableLayoutContent>
              <TableLayoutHeadRow>
                <TableHead>Date</TableHead>
                <TableHead>Payment ID</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableLayoutHeadRow>
              <TableLayoutBody>
                {isLoading ? <LoadingTableRow columns={6} /> : null}
                {!isLoading && visiblePayments.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="h-24 text-center text-muted-foreground"
                      colSpan={6}
                    >
                      No Subscription Payments in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
                {isLoading
                  ? null
                  : visiblePayments.map((payment) => (
                      <TableRow key={payment.ID}>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                          {DATE_TIME_FORMATTER.format(new Date(payment.Time))}
                        </TableCell>
                        <TableCell className="max-w-48 break-all font-mono text-xs">
                          {payment.ID}
                        </TableCell>
                        <TableCell>
                          {workspaceName(workspaceNames, payment.Workspace)}
                        </TableCell>
                        <TableCell className="capitalize">
                          {subscriptionPaymentDescription(payment)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">Paid</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatBillingAmount(payment.Amount, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
              </TableLayoutBody>
            </TableLayoutContent>
            <TableLayoutFooter>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted-foreground text-sm">
                  {scopedPayments.length} payments
                </span>
                <Pagination
                  currentPage={visiblePaymentPage}
                  onPageChange={setPaymentPage}
                  totalPages={totalPaymentPages}
                />
              </div>
            </TableLayoutFooter>
          </TableLayout>
        </TabsContent>
      </Tabs>
    </div>
  );
}
