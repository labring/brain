"use client";

import { DateRangePicker } from "@workspace/ui/components/date-range-picker";
import { useAtomValue } from "jotai";
import { useState } from "react";
import useSWR from "swr";

import {
  BillingAppCostDrawer,
  type SelectedBillingApp,
} from "@/features/billing/billing-app-cost-drawer";
import {
  type BillingCostScope,
  type BillingCostsSnapshot,
  type BillingDateRange,
  calendarBillingDateRange,
  fixedTrendWindows,
  loadBillingAppOverview,
  loadBillingCostsBase,
  loadBillingDailyTrend,
  loadBillingMonthlyTrend,
} from "@/features/billing/billing-costs-data";
import {
  reconcileAppTypeFilter,
  reconcileCostScope,
} from "@/features/billing/billing-costs-state";
import { BillingCostsSurface as BillingCostsSurfaceView } from "@/features/billing/billing-costs-surface";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom } from "@/lib/auth-store";

const APP_PAGE_SIZE = 5;

// Static fixture for the render test: one region, one workspace, the three
// tier plans, and one PAYG app row.
const FIXTURE_SNAPSHOT: BillingCostsSnapshot = {
  appOverviews: [
    {
      amount: 3_000_000,
      appName: "devbox-main",
      appType: 10,
      namespace: "ws-sealos-test",
    },
  ],
  appTypes: { "10": "DEV-BOX" },
  costPoints: [],
  currentRegion: {
    domain: "hzh.sealos.run",
    name: { en: "Hangzhou", zh: "杭州" },
    uid: "region-hzh",
  },
  payments: [
    {
      Amount: 5_000_000,
      ID: "payment-starter",
      Operator: "created",
      PlanName: "Starter",
      Time: "2026-01-05T10:00:00.000Z",
      Type: "SUBSCRIPTION",
      Workspace: "ws-sealos-test",
    },
    {
      Amount: 20_000_000,
      ID: "payment-pro",
      Operator: "upgraded",
      PlanName: "Pro",
      Time: "2026-01-12T10:00:00.000Z",
      Type: "SUBSCRIPTION",
      Workspace: "ws-sealos-test",
    },
    {
      Amount: 50_000_000,
      ID: "payment-enterprise",
      Operator: "upgraded",
      PlanName: "Enterprise",
      Time: "2026-01-20T10:00:00.000Z",
      Type: "SUBSCRIPTION",
      Workspace: "ws-sealos-test",
    },
  ],
  totalAppOverviewPages: 1,
  totalAppOverviews: 1,
  totalConsumptionMicroUnits: 3_000_000,
  workspaceConsumptionMicroUnits: { "ws-sealos-test": 3_000_000 },
  workspaces: [["ws-sealos-test", "sealos-test"]],
};

export function BillingCostsSurface() {
  return (
    <BillingCostsSurfaceView
      appPage={1}
      appTypeFilter={null}
      currency="usd"
      dateFilter={
        <span className="text-muted-foreground text-sm">Last 30 days</span>
      }
      dateRange={{
        endTime: "2026-01-31T23:59:59.999Z",
        startTime: "2026-01-01T00:00:00.000Z",
      }}
      error={null}
      isLoading={false}
      scope={{ kind: "workspace", workspace: "ws-sealos-test" }}
      snapshot={FIXTURE_SNAPSHOT}
    />
  );
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateRange(): BillingDateRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  const range = calendarBillingDateRange({
    end: dateInputValue(end),
    start: dateInputValue(start),
  });
  if (range == null) {
    throw new Error("Default billing date range is invalid.");
  }
  return range;
}

export default function BillingCosts({
  currency,
}: {
  currency: BillingCurrency;
}) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const [dateRange, setDateRange] =
    useState<BillingDateRange>(defaultDateRange);
  // The trend charts ignore the page-level date selector (old Cost Center
  // behavior): mount time anchors their fixed 7-day / 6-month windows.
  const [trendWindows] = useState(() => fixedTrendWindows(new Date()));
  const [scope, setScope] = useState<BillingCostScope>({ kind: "region" });
  const [appTypeFilter, setAppTypeFilter] = useState<string | null>(null);
  const [appPage, setAppPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<SelectedBillingApp | null>(
    null
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const credentialsReady = appToken.trim() !== "" && kubeconfig.trim() !== "";
  // Tree / totals / payments only depend on the date range. Paging the app
  // overview table must not re-fetch or re-skeleton the cost tree.
  const costsBase = useSWR(
    credentialsReady
      ? [
          "billing-costs-base",
          dateRange.startTime,
          dateRange.endTime,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingCostsBase({
        appToken,
        dateRange,
        kubeconfig,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  // The workspace list and app-type catalog are scoped to the date range, so
  // after a range change the scope/filter can point at entries the new
  // snapshot no longer lists. Reconcile during render, ahead of the request
  // that keys on them (never mid-flight): an orphaned workspace scope
  // silently falls back to the region card, an orphaned type filter to "All".
  const baseSnapshot = costsBase.data;
  if (baseSnapshot != null) {
    const nextScope = reconcileCostScope(scope, baseSnapshot.workspaces);
    const nextAppTypeFilter = reconcileAppTypeFilter(
      appTypeFilter,
      baseSnapshot.appTypes
    );
    if (nextScope !== scope || nextAppTypeFilter !== appTypeFilter) {
      setScope(nextScope);
      setAppTypeFilter(nextAppTypeFilter);
      setAppPage(1);
    }
  }
  const selectedWorkspace = scope.kind === "workspace" ? scope.workspace : null;
  const appOverview = useSWR(
    credentialsReady
      ? [
          "billing-costs-overview",
          dateRange.startTime,
          dateRange.endTime,
          selectedWorkspace,
          appTypeFilter,
          appPage,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingAppOverview({
        appToken,
        appType: appTypeFilter,
        dateRange,
        kubeconfig,
        page: appPage,
        pageSize: APP_PAGE_SIZE,
        workspace: selectedWorkspace,
      }),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
  // On failure SWR still exposes the previous key's kept data; the error is
  // authoritative — never render another scope's rows under this scope's
  // banner.
  const appOverviewPage =
    appOverview.error == null ? appOverview.data : undefined;
  const data: BillingCostsSnapshot | undefined =
    costsBase.data == null
      ? undefined
      : {
          ...costsBase.data,
          appOverviews: appOverviewPage?.appOverviews ?? [],
          totalAppOverviewPages: appOverviewPage?.totalAppOverviewPages ?? 1,
          totalAppOverviews: appOverviewPage?.totalAppOverviews ?? 0,
        };
  // Only the base snapshot (tree, totals, payments) escalates to the
  // page-level banner; an app-overview failure stays inside the PAYG table.
  const error = costsBase.error;
  const isLoading = costsBase.isLoading;
  const isAppOverviewLoading = appOverview.isLoading;
  const dailyTrend = useSWR(
    credentialsReady
      ? [
          "billing-trend-daily",
          trendWindows.daily.startTime,
          trendWindows.daily.endTime,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingDailyTrend({
        appToken,
        dateRange: trendWindows.daily,
        kubeconfig,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  const monthlyTrend = useSWR(
    credentialsReady
      ? [
          "billing-trend-monthly",
          trendWindows.monthly.startTime,
          trendWindows.monthly.endTime,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingMonthlyTrend({
        appToken,
        dateRange: trendWindows.monthly,
        kubeconfig,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const closeAppDrawer = () => {
    setSelectedApp(null);
    setDrawerOpen(false);
  };

  const applyDateRange = (range: { from: Date; to: Date }) => {
    setDateRange({
      endTime: range.to.toISOString(),
      startTime: range.from.toISOString(),
    });
    setAppPage(1);
    closeAppDrawer();
  };

  const selectScope = (nextScope: BillingCostScope) => {
    setScope(nextScope);
    setAppPage(1);
    closeAppDrawer();
  };

  const selectAppTypeFilter = (appType: string | null) => {
    setAppTypeFilter(appType);
    setAppPage(1);
    closeAppDrawer();
  };

  const selectApp = (app: SelectedBillingApp) => {
    setSelectedApp(app);
    setDrawerOpen(true);
  };

  const dateFilter = (
    <DateRangePicker
      onChange={applyDateRange}
      value={{
        from: new Date(dateRange.startTime),
        to: new Date(dateRange.endTime),
      }}
    />
  );
  const drawerKey = selectedApp
    ? `${selectedApp.namespace}-${selectedApp.appType}-${selectedApp.appName}-${dateRange.startTime}-${dateRange.endTime}`
    : "billing-app-cost-drawer";

  return (
    <>
      <BillingCostsSurfaceView
        appOverviewError={appOverview.error}
        appPage={appPage}
        appTypeFilter={appTypeFilter}
        currency={currency}
        dailyTrend={dailyTrend.data}
        dailyTrendError={dailyTrend.error}
        dateFilter={dateFilter}
        dateRange={dateRange}
        error={error}
        isAppOverviewLoading={!credentialsReady || isAppOverviewLoading}
        isDailyTrendLoading={!credentialsReady || dailyTrend.isLoading}
        isLoading={!credentialsReady || isLoading}
        isMonthlyTrendLoading={!credentialsReady || monthlyTrend.isLoading}
        monthlyTrend={monthlyTrend.data}
        monthlyTrendError={monthlyTrend.error}
        onAppPageChange={setAppPage}
        onAppTypeFilterChange={selectAppTypeFilter}
        onScopeChange={selectScope}
        onSelectApp={selectApp}
        scope={scope}
        snapshot={data}
      />
      <BillingAppCostDrawer
        appToken={appToken}
        currency={currency}
        dateRange={dateRange}
        key={drawerKey}
        kubeconfig={kubeconfig}
        onOpenChange={setDrawerOpen}
        open={drawerOpen}
        selectedApp={selectedApp}
      />
    </>
  );
}
