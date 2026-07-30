"use client";

import { Badge } from "@workspace/ui/components/badge";
import { Pagination } from "@workspace/ui/components/pagination";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet";
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
import { useState } from "react";
import useSWR from "swr";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import {
  type BillingAppCost,
  type BillingAppOverview,
  type BillingDateRange,
  loadBillingAppCosts,
} from "@/features/billing/billing-costs-data";
import type { BillingCurrency } from "@/features/billing/config-core";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});
const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const PAGE_SIZE = 10;
const SKELETON_ROW_KEYS = ["time", "workload", "cpu", "memory", "storage"];

const RESOURCE_COLUMNS = [
  { index: "0", label: "CPU", unit: "m" },
  { index: "1", label: "Memory", unit: " MiB" },
  { index: "2", label: "Storage", unit: " MiB" },
  { index: "3", label: "Network", unit: " MB" },
] as const;

interface AppCostRow {
  amount: number;
  id: string;
  time: string;
  used: Record<string, number>;
  usedAmount: Record<string, number>;
  workload: string;
}

export interface SelectedBillingApp extends BillingAppOverview {
  queryAppType: string;
  typeName: string;
  workspaceName: string;
}

interface BillingAppCostDrawerProps {
  appToken: string;
  currency: BillingCurrency;
  dateRange: BillingDateRange;
  kubeconfig: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedApp: SelectedBillingApp | null;
}

function rowsFromCosts(costs: BillingAppCost[]): AppCostRow[] {
  return costs.flatMap((cost) => {
    const resources =
      cost.resources_by_type.length > 0
        ? cost.resources_by_type
        : [
            {
              amount: cost.amount,
              app_name: cost.app_name,
              app_type: cost.app_type,
              used: {},
              used_amount: {},
            },
          ];
    return resources.map((resource, index) => ({
      amount: resource.amount,
      id: `${cost.order_id || cost.time}-${resource.app_type}-${resource.app_name}-${index}`,
      time: cost.time,
      used: resource.used,
      usedAmount: resource.used_amount,
      workload: resource.app_name || cost.app_name || "-",
    }));
  });
}

function ResourceAmount({
  currency,
  index,
  row,
  unit,
}: {
  currency: BillingCurrency;
  index: string;
  row: AppCostRow;
  unit: string;
}) {
  const usage = row.used[index];
  if (usage == null) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-foreground tabular-nums">
        {usage}
        {unit}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">
        {formatBillingAmount(row.usedAmount[index] ?? 0, currency)}
      </span>
    </div>
  );
}

export function BillingAppCostDrawer({
  appToken,
  currency,
  dateRange,
  kubeconfig,
  onOpenChange,
  open,
  selectedApp,
}: BillingAppCostDrawerProps) {
  const [page, setPage] = useState(1);
  const credentialsReady = appToken.trim() !== "" && kubeconfig.trim() !== "";
  const canLoad =
    open &&
    credentialsReady &&
    selectedApp != null &&
    selectedApp.namespace.trim() !== "";
  const { data, error, isLoading } = useSWR(
    canLoad
      ? [
          "billing-app-costs",
          selectedApp.appName,
          selectedApp.queryAppType,
          selectedApp.namespace,
          dateRange.startTime,
          dateRange.endTime,
          page,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingAppCosts({
        appName: selectedApp?.appName ?? "",
        appToken,
        appType: selectedApp?.queryAppType ?? "",
        dateRange,
        kubeconfig,
        namespace: selectedApp?.namespace ?? "",
        page,
        pageSize: PAGE_SIZE,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const rows = rowsFromCosts(data?.costs ?? []);

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full sm:max-w-5xl">
        <SheetHeader className="border-border border-b pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle>{selectedApp?.appName || "App consumption"}</SheetTitle>
            {selectedApp?.typeName ? (
              <Badge variant="secondary">{selectedApp.typeName}</Badge>
            ) : null}
          </div>
          <SheetDescription>
            {selectedApp?.workspaceName ?? "Workspace"} /{" "}
            {DATE_FORMATTER.format(new Date(dateRange.startTime))} -{" "}
            {DATE_FORMATTER.format(new Date(dateRange.endTime))}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          <TableLayout>
            <TableLayoutCaption>
              <span className="font-medium">Consumption Cost</span>
              <Badge variant="outline">Hourly</Badge>
            </TableLayoutCaption>
            <TableLayoutContent>
              <TableLayoutHeadRow>
                <TableHead>Time</TableHead>
                <TableHead>Workload</TableHead>
                {RESOURCE_COLUMNS.map((resource) => (
                  <TableHead key={resource.index}>{resource.label}</TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableLayoutHeadRow>
              <TableLayoutBody>
                {isLoading || !credentialsReady
                  ? SKELETON_ROW_KEYS.map((key) => (
                      <TableRow key={`app-cost-skeleton-${key}`}>
                        <TableCell colSpan={7}>
                          <Skeleton className="h-8 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
                {error == null ? null : (
                  <TableRow>
                    <TableCell
                      className="h-24 text-center text-destructive"
                      colSpan={7}
                    >
                      App consumption is unavailable.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && error == null && rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      className="h-24 text-center text-muted-foreground"
                      colSpan={7}
                    >
                      No Consumption Cost in this period.
                    </TableCell>
                  </TableRow>
                ) : null}
                {!isLoading && error == null
                  ? rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground text-xs">
                          {DATE_TIME_FORMATTER.format(new Date(row.time))}
                        </TableCell>
                        <TableCell className="font-medium">
                          {row.workload}
                        </TableCell>
                        {RESOURCE_COLUMNS.map((resource) => (
                          <TableCell key={resource.index}>
                            <ResourceAmount
                              currency={currency}
                              index={resource.index}
                              row={row}
                              unit={resource.unit}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatBillingAmount(row.amount, currency)}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableLayoutBody>
            </TableLayoutContent>
            <TableLayoutFooter>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted-foreground text-sm">
                  {data?.totalRecords ?? 0} records
                </span>
                <Pagination
                  currentPage={page}
                  onPageChange={setPage}
                  totalPages={data?.totalPages ?? 1}
                />
              </div>
            </TableLayoutFooter>
          </TableLayout>
        </div>
      </SheetContent>
    </Sheet>
  );
}
