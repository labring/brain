"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { Input } from "@workspace/ui/components/input";
import { useAtomValue } from "jotai";
import { CalendarRange } from "lucide-react";
import { type FormEvent, useState } from "react";
import useSWR from "swr";

import {
  BillingAppCostDrawer,
  type SelectedBillingApp,
} from "@/features/billing/billing-app-cost-drawer";
import {
  type BillingDateRange,
  calendarBillingDateRange,
  loadBillingCosts,
} from "@/features/billing/billing-costs-data";
import { BillingCostsSurface as BillingCostsSurfaceView } from "@/features/billing/billing-costs-surface";
import type { BillingCurrency } from "@/features/billing/config-core";
import { appTokenAtom, kubeconfigAtom } from "@/lib/auth-store";

const APP_PAGE_SIZE = 10;

export const BillingCostsSurface = BillingCostsSurfaceView;

interface DateInputs {
  end: string;
  start: string;
}

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultDateInputs(): DateInputs {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { end: dateInputValue(end), start: dateInputValue(start) };
}

export default function BillingCosts({
  currency,
}: {
  currency: BillingCurrency;
}) {
  const appToken = useAtomValue(appTokenAtom);
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const [draftDates, setDraftDates] = useState(defaultDateInputs);
  const [dateRange, setDateRange] = useState<BillingDateRange>(() => {
    const range = calendarBillingDateRange(defaultDateInputs());
    if (range == null) {
      throw new Error("Default billing date range is invalid.");
    }
    return range;
  });
  const [dateError, setDateError] = useState<string | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null>(
    null
  );
  const [appPage, setAppPage] = useState(1);
  const [selectedApp, setSelectedApp] = useState<SelectedBillingApp | null>(
    null
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const credentialsReady = appToken.trim() !== "" && kubeconfig.trim() !== "";
  const { data, error, isLoading } = useSWR(
    credentialsReady
      ? [
          "billing-costs",
          dateRange.startTime,
          dateRange.endTime,
          selectedWorkspace,
          appPage,
          appToken,
          kubeconfig,
        ]
      : null,
    () =>
      loadBillingCosts({
        appToken,
        dateRange,
        kubeconfig,
        page: appPage,
        pageSize: APP_PAGE_SIZE,
        workspace: selectedWorkspace,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const applyDateRange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const range = calendarBillingDateRange(draftDates);
    if (range == null) {
      setDateError("Choose a valid start and end date.");
      return;
    }
    setDateError(null);
    setDateRange(range);
    setAppPage(1);
    setSelectedApp(null);
    setDrawerOpen(false);
  };

  const selectWorkspace = (workspace: string | null) => {
    setSelectedWorkspace(workspace);
    setAppPage(1);
    setSelectedApp(null);
    setDrawerOpen(false);
  };

  const selectApp = (app: SelectedBillingApp) => {
    setSelectedApp(app);
    setDrawerOpen(true);
  };

  const dateFilter = (
    <form className="flex flex-wrap items-end gap-2" onSubmit={applyDateRange}>
      <label className="flex flex-col gap-1" htmlFor="billing-costs-start">
        <span className="text-muted-foreground text-xs">From</span>
        <Input
          aria-invalid={dateError != null}
          className="w-36"
          id="billing-costs-start"
          onChange={(event) =>
            setDraftDates((current) => ({
              ...current,
              start: event.target.value,
            }))
          }
          type="date"
          value={draftDates.start}
        />
      </label>
      <label className="flex flex-col gap-1" htmlFor="billing-costs-end">
        <span className="text-muted-foreground text-xs">To</span>
        <Input
          aria-invalid={dateError != null}
          className="w-36"
          id="billing-costs-end"
          onChange={(event) =>
            setDraftDates((current) => ({
              ...current,
              end: event.target.value,
            }))
          }
          type="date"
          value={draftDates.end}
        />
      </label>
      <AppButton type="submit" variant="secondary">
        <CalendarRange aria-hidden data-icon="inline-start" />
        Apply
      </AppButton>
      {dateError == null ? null : (
        <span className="w-full text-destructive text-xs" role="alert">
          {dateError}
        </span>
      )}
    </form>
  );
  const drawerKey = selectedApp
    ? `${selectedApp.namespace}-${selectedApp.appType}-${selectedApp.appName}-${dateRange.startTime}-${dateRange.endTime}`
    : "billing-app-cost-drawer";

  return (
    <>
      <BillingCostsSurface
        appPage={appPage}
        currency={currency}
        dateFilter={dateFilter}
        dateRange={dateRange}
        error={error}
        isLoading={!credentialsReady || isLoading}
        onAppPageChange={setAppPage}
        onSelectApp={selectApp}
        onSelectWorkspace={selectWorkspace}
        selectedWorkspace={selectedWorkspace}
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
