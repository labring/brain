"use client";

import { Quantity } from "@workspace/shared";
import { AppTypeIcon } from "@workspace/ui/components/app-type-icon";
import { Badge } from "@workspace/ui/components/badge";
import { DateRangePicker } from "@workspace/ui/components/date-range-picker";
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
import { cn } from "@workspace/ui/lib/utils";
import { Fragment, useState } from "react";
import useSWR from "swr";

import { formatPreciseBillingAmount } from "@/features/billing/billing-amount";
import {
  type BillingAppCost,
  type BillingAppOverview,
  type BillingDateRange,
  loadBillingAppCosts,
} from "@/features/billing/billing-costs-data";
import type { BillingCredentials } from "@/features/billing/billing-data-client";
import type { BillingCurrency } from "@/features/billing/config-core";

const PAGE_SIZE = 10;
const SKELETON_ROW_KEYS = [
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

// The old drawer resource pairs: usage column + Amount column per resource.
// `used` / `used_amount` are keyed by resource index in the account API.
const RESOURCE_COLUMNS = [
  { index: "0", label: "CPU", suffix: "m" },
  { index: "1", label: "Memory", suffix: "Mi" },
  { index: "2", label: "Storage", suffix: "Mi" },
  { index: "3", label: "Network", suffix: "" },
  { index: "4", label: "Port", suffix: "" },
  { index: "5", label: "GPU", suffix: "" },
] as const;
const COLUMN_COUNT = RESOURCE_COLUMNS.length * 2 + 2;

interface AppCostRow {
  amount: number;
  id: string;
  time: string;
  used: Record<string, number>;
  usedAmount: Record<string, number>;
}

type DrawerTableRow =
  | { day: string; type: "separator" }
  | { row: AppCostRow; type: "data" };

export interface SelectedBillingApp extends BillingAppOverview {
  queryAppType: string;
  regionName: string;
  typeName: string;
  workspaceName: string;
}

interface BillingAppCostDrawerProps extends BillingCredentials {
  currency: BillingCurrency;
  dateRange: BillingDateRange;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedApp: SelectedBillingApp | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function dayLabel(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate()
  )}`;
}

function hourLabel(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatResourceQuantity(value: number, suffix: string): string {
  try {
    return Quantity.parse(`${value}${suffix}`).toString();
  } catch {
    return `${value}${suffix}`;
  }
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
    }));
  });
}

/** Interleave the old per-day separator rows into the hourly rows. */
function groupRowsByDay(rows: AppCostRow[]): DrawerTableRow[] {
  const grouped: DrawerTableRow[] = [];
  let currentDay: string | null = null;
  for (const row of rows) {
    const day = dayLabel(new Date(row.time));
    if (day !== currentDay) {
      grouped.push({ day, type: "separator" });
      currentDay = day;
    }
    grouped.push({ row, type: "data" });
  }
  return grouped;
}

// Old pair styling: usage columns open the pair with a left border, Amount
// columns close it with a right border.
function pairCellClass(isUsageColumn: boolean): string {
  return isUsageColumn
    ? "border-border border-l pr-2 pl-4 text-center"
    : "border-border border-r pr-4 pl-2 text-center";
}

function NegativeAmount({
  amountMicroUnits,
  currency,
}: {
  amountMicroUnits: number;
  currency: BillingCurrency;
}) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      -{formatPreciseBillingAmount(amountMicroUnits, currency)}
    </span>
  );
}

function MessageRow({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <TableRow>
      <TableCell
        className={cn("h-24 text-center text-muted-foreground", className)}
        colSpan={COLUMN_COUNT}
      >
        {children}
      </TableCell>
    </TableRow>
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
  // The drawer keeps its own range like the old Billing & Usage drawer; the
  // parent remounts this component when the page-level range changes.
  const [drawerRange, setDrawerRange] = useState<BillingDateRange>(dateRange);
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
          drawerRange.startTime,
          drawerRange.endTime,
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
        dateRange: drawerRange,
        kubeconfig,
        namespace: selectedApp?.namespace ?? "",
        page,
        pageSize: PAGE_SIZE,
      }),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
  // On failure SWR still exposes the previous key's kept data; the error is
  // authoritative — never render another page's rows or totals as this one's.
  const costsPage = error == null ? data : undefined;
  const tableRows = groupRowsByDay(rowsFromCosts(costsPage?.costs ?? []));
  const showSkeleton = isLoading || !credentialsReady;

  const applyDrawerRange = (range: { from: Date; to: Date }) => {
    setDrawerRange({
      endTime: range.to.toISOString(),
      startTime: range.from.toISOString(),
    });
    setPage(1);
  };

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      {/* The old Cost Center floating panel: 12px viewport margins, large
          radius, width following the 14-column table up to the viewport cap.
          Carries the Canvas Glow material like the Billing Area behind it, so
          its own content must stay below z-20. */}
      <SheetContent className="canvas-glow-overlay gap-0 data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto data-[side=right]:w-fit data-[side=right]:max-w-[calc(100vw-1.5rem)] data-[side=right]:rounded-2xl data-[side=right]:border data-[side=right]:sm:max-w-[calc(100vw-1.5rem)]">
        <SheetHeader className="border-border border-b pr-14">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <AppTypeIcon
              appTypeCode={selectedApp?.queryAppType}
              className="size-5 text-brand-primary"
            />
            <span className="text-nowrap">
              {selectedApp?.appName || selectedApp?.typeName || "App"}
            </span>
            <Badge variant="secondary">
              {`${selectedApp?.regionName ?? "Region"} / ${
                selectedApp?.workspaceName ?? "Workspace"
              }`}
            </Badge>
            {selectedApp?.typeName ? (
              <Badge variant="secondary">{selectedApp.typeName}</Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Hourly billing and usage for the selected app.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 p-5">
          {/* The table container is the single scroller for both axes so the
              sticky header (top) and day separators (left) share it. */}
          <TableLayout className="flex h-full flex-col [&_[data-slot=table-container]]:min-h-0 [&_[data-slot=table-container]]:flex-1 [&_[data-slot=table-container]]:overflow-auto">
            <TableLayoutCaption className="text-base">
              <div className="flex items-center gap-2">
                <span className="font-medium">Billing & Usage</span>
                <Badge variant="secondary">Hourly</Badge>
              </div>
              <DateRangePicker
                onChange={applyDrawerRange}
                value={{
                  from: new Date(drawerRange.startTime),
                  to: new Date(drawerRange.endTime),
                }}
              />
            </TableLayoutCaption>
            <TableLayoutContent>
              <TableLayoutHeadRow
                className={{
                  thead: "sticky top-0 z-10",
                  tr: "[&>th]:bg-input/30 [&>th]:backdrop-blur-md",
                }}
              >
                <TableHead>Time</TableHead>
                {RESOURCE_COLUMNS.map((resource) => (
                  <Fragment key={resource.index}>
                    <TableHead className={pairCellClass(true)}>
                      {resource.label}
                    </TableHead>
                    <TableHead className={pairCellClass(false)}>
                      Amount
                    </TableHead>
                  </Fragment>
                ))}
                <TableHead className="text-right">Total Amount</TableHead>
              </TableLayoutHeadRow>
              <TableLayoutBody>
                {showSkeleton
                  ? SKELETON_ROW_KEYS.map((key) => (
                      <TableRow className="h-14" key={`app-cost-${key}`}>
                        <TableCell colSpan={COLUMN_COUNT}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
                {error == null ? null : (
                  <MessageRow className="text-destructive">
                    App consumption is unavailable.
                  </MessageRow>
                )}
                {!showSkeleton && error == null && tableRows.length === 0 ? (
                  <MessageRow>No Data Available</MessageRow>
                ) : null}
                {showSkeleton || error != null
                  ? null
                  : tableRows.map((tableRow) =>
                      tableRow.type === "separator" ? (
                        <TableRow
                          className="hover:bg-transparent"
                          key={`day-${tableRow.day}`}
                        >
                          <TableCell
                            className="bg-muted font-normal text-foreground dark:bg-white/8"
                            colSpan={COLUMN_COUNT}
                          >
                            <span className="sticky left-4 inline-block">
                              {tableRow.day}
                            </span>
                          </TableCell>
                        </TableRow>
                      ) : (
                        <TableRow className="h-14" key={tableRow.row.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {hourLabel(new Date(tableRow.row.time))}
                          </TableCell>
                          {RESOURCE_COLUMNS.map((resource) => {
                            const usage = tableRow.row.used[resource.index];
                            return (
                              <Fragment key={resource.index}>
                                <TableCell className={pairCellClass(true)}>
                                  {usage == null ? (
                                    <span className="text-muted-foreground">
                                      -
                                    </span>
                                  ) : (
                                    <span className="tabular-nums">
                                      {formatResourceQuantity(
                                        usage,
                                        resource.suffix
                                      )}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className={pairCellClass(false)}>
                                  {usage == null ? (
                                    <span className="text-muted-foreground">
                                      -
                                    </span>
                                  ) : (
                                    <NegativeAmount
                                      amountMicroUnits={
                                        tableRow.row.usedAmount[
                                          resource.index
                                        ] ?? 0
                                      }
                                      currency={currency}
                                    />
                                  )}
                                </TableCell>
                              </Fragment>
                            );
                          })}
                          <TableCell className="text-right font-medium">
                            <NegativeAmount
                              amountMicroUnits={tableRow.row.amount}
                              currency={currency}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    )}
              </TableLayoutBody>
            </TableLayoutContent>
            <TableLayoutFooter>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-1 text-muted-foreground">
                  Total:{" "}
                  {showSkeleton ? (
                    <Skeleton className="h-4 w-8" />
                  ) : (
                    (costsPage?.totalRecords ?? 0)
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Pagination
                    currentPage={page}
                    onPageChange={setPage}
                    totalPages={costsPage?.totalPages ?? 1}
                  />
                  <span>
                    {PAGE_SIZE}
                    <span className="text-muted-foreground"> / Page</span>
                  </span>
                </div>
              </div>
            </TableLayoutFooter>
          </TableLayout>
        </div>
      </SheetContent>
    </Sheet>
  );
}
