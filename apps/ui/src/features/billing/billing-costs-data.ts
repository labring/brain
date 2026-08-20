import { appTypeDisplayName } from "@workspace/ui/assets/app-icons";
import { z } from "zod";
import {
  type BillingCredentials,
  type BillingFetch,
  BillingRequestError,
  createBillingJsonRequester,
} from "./billing-data-client";

const workspaceSchema = z.tuple([z.string(), z.string()]);
const appOverviewSchema = z.object({
  appName: z.string(),
  appType: z.number(),
  amount: z.number(),
  namespace: z.string(),
  regionDomain: z.string().optional(),
});
const paymentSchema = z.object({
  Amount: z.number(),
  ID: z.string(),
  Operator: z.string(),
  PlanName: z.string(),
  Status: z.string().optional(),
  Time: z.iso.datetime(),
  Type: z.string(),
  Workspace: z.string(),
});
const regionSchema = z.object({
  domain: z.string().trim().min(1),
  name: z
    .object({
      en: z.string().trim().min(1),
      zh: z.string(),
    })
    .optional(),
  uid: z.string().trim().min(1),
});

const appTypesResponseSchema = z.object({
  data: z.record(z.string(), z.string()),
});
const consumptionResponseSchema = z.object({ amount: z.number() });
const workspaceConsumptionResponseSchema = z.object({
  amount: z.record(z.string(), z.number()),
});
const workspacesResponseSchema = z.object({ data: z.array(workspaceSchema) });
// Upstream marshals slices built by `append` without `omitempty`, so an empty
// period arrives as JSON null, a normal empty state — not `[]` and not absent.
const nullableArray = <T extends z.ZodType>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((value) => value ?? []);

const appOverviewResponseSchema = z.object({
  data: z.object({
    overviews: nullableArray(appOverviewSchema),
    total: z.number(),
    totalPage: z.number(),
  }),
});
const costsResponseSchema = z.object({
  data: z.object({
    costs: z.array(z.tuple([z.number(), z.union([z.string(), z.number()])])),
  }),
  message: z.string().optional(),
});
const paymentsResponseSchema = z.object({ payments: z.array(paymentSchema) });
// The regions route marks the deployment's own region; the catalog's order
// carries no meaning, so loaders read `current` and never an index.
const regionsResponseSchema = z.object({ current: regionSchema });
const appCostResourceSchema = z.object({
  amount: z.number().default(0),
  app_name: z.string().default(""),
  app_type: z.number().default(0),
  used: z.record(z.string(), z.number()).default({}),
  used_amount: z.record(z.string(), z.number()).default({}),
});
const appCostSchema = z.object({
  amount: z.number().default(0),
  app_name: z.string().default(""),
  app_type: z.number().default(0),
  namespace: z.string(),
  order_id: z.string().default(""),
  resources_by_type: z.array(appCostResourceSchema).default([]),
  time: z.iso.datetime(),
});
const appCostsResponseSchema = z.object({
  app_costs: z.object({
    costs: nullableArray(appCostSchema),
    current_page: z.number().default(1),
    total_pages: z.number().default(1),
    total_records: z.number().default(0),
  }),
});

export interface BillingDateRange {
  endTime: string;
  startTime: string;
}

/** Which node of the old /billing cost tree is selected. */
export type BillingCostScope =
  | { kind: "region" }
  | { kind: "total" }
  | { kind: "workspace"; workspace: string };

export function calendarBillingDateRange(input: {
  end: string;
  start: string;
}): BillingDateRange | null {
  const start = new Date(`${input.start}T00:00:00.000Z`);
  const end = new Date(`${input.end}T23:59:59.999Z`);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start.toISOString().slice(0, 10) !== input.start ||
    end.toISOString().slice(0, 10) !== input.end ||
    start > end
  ) {
    return null;
  }
  return { endTime: end.toISOString(), startTime: start.toISOString() };
}

/**
 * Fixed chart windows anchored at `now`, the old Cost Center behavior: the
 * daily chart always covers the last 7 days and the monthly chart the last 6
 * calendar months, independent of the Billing view's date selector.
 */
export function fixedTrendWindows(now: Date): {
  daily: BillingDateRange;
  monthly: BillingDateRange;
} {
  const endTime = now.toISOString();
  const dailyStart = new Date(now);
  dailyStart.setUTCDate(dailyStart.getUTCDate() - 6);
  dailyStart.setUTCHours(0, 0, 0, 0);
  const monthlyStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)
  );
  return {
    daily: { endTime, startTime: dailyStart.toISOString() },
    monthly: { endTime, startTime: monthlyStart.toISOString() },
  };
}

export interface LoadBillingCostsBaseInput extends BillingCredentials {
  dateRange: BillingDateRange;
}

export interface LoadBillingAppOverviewInput extends BillingCredentials {
  appType?: string | null;
  dateRange: BillingDateRange;
  page: number;
  pageSize: number;
  workspace: string | null;
}

/** Full Costs snapshot load (base + paginated app overview). */
export type LoadBillingCostsInput = LoadBillingCostsBaseInput &
  LoadBillingAppOverviewInput;

export interface LoadBillingAppCostsInput extends BillingCredentials {
  appName: string;
  appType: string;
  dateRange: BillingDateRange;
  namespace: string;
  page: number;
  pageSize: number;
}

export type BillingWorkspace = z.infer<typeof workspaceSchema>;
export type BillingAppOverview = z.infer<typeof appOverviewSchema>;
export type SubscriptionPayment = z.infer<typeof paymentSchema>;
export type BillingRegion = z.infer<typeof regionSchema>;
export type BillingAppCost = z.infer<typeof appCostSchema>;

export interface BillingAppCostsPage {
  costs: BillingAppCost[];
  currentPage: number;
  totalPages: number;
  totalRecords: number;
}

/** Costs canvas data that does not depend on app-overview pagination. */
export interface BillingCostsBaseSnapshot {
  appTypes: Record<string, string>;
  costPoints: [number, string | number][];
  /** The Current Region; null only in the pre-load empty snapshot. */
  currentRegion: BillingRegion | null;
  /** Subscription Payments attributed to the Current Region's workspaces. */
  payments: SubscriptionPayment[];
  totalConsumptionMicroUnits: number;
  workspaceConsumptionMicroUnits: Record<string, number>;
  workspaces: BillingWorkspace[];
}

export interface BillingAppOverviewPage {
  appOverviews: BillingAppOverview[];
  totalAppOverviewPages: number;
  totalAppOverviews: number;
}

export type BillingCostsSnapshot = BillingCostsBaseSnapshot &
  BillingAppOverviewPage;

export interface MonthlyBillingTrendPoint {
  expenditureMicroUnits: number;
  label: string;
  month: string;
  paymentMicroUnits: number;
}

export interface DailyCostTrendSeries {
  dataKey: string;
  label: string;
}

export interface DailyCostTrendPoint extends Record<string, number | string> {
  label: string;
}

export interface DailyCostTrend {
  points: DailyCostTrendPoint[];
  series: DailyCostTrendSeries[];
}

export interface RegionCostPoints {
  costPoints: BillingCostsSnapshot["costPoints"];
  label: string;
}

export interface WorkspaceCostBreakdown {
  consumptionMicroUnits: number;
  id: string;
  name: string;
  subscriptionMicroUnits: number;
  totalMicroUnits: number;
}

export function resolveBillingAppType(
  appType: number,
  appTypes: Record<string, string>
): { queryAppType: string; typeName: string } {
  const rawAppType = String(appType);
  // The account service maps the numeric app type to a code such as "DB" or
  // "DEV-BOX"; queries echo that code back, while the UI shows its display
  // name.
  const appTypeCode = appTypes[rawAppType];
  return {
    queryAppType: appTypeCode ?? rawAppType,
    typeName: appTypeCode
      ? (appTypeDisplayName(appTypeCode) ?? appTypeCode)
      : `App type ${rawAppType}`,
  };
}

const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});
const DAY_LABEL_FORMATTER = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;
}

function monthsInRange(dateRange: BillingDateRange): Date[] {
  const start = new Date(dateRange.startTime);
  const end = new Date(dateRange.endTime);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return [];
  }

  const months: Date[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );
  const lastMonth = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1);
  while (cursor.getTime() <= lastMonth) {
    months.push(new Date(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

export function isPaidSubscriptionPayment(
  payment: SubscriptionPayment
): boolean {
  return payment.Status == null || payment.Status.toUpperCase() === "PAID";
}

export function subscriptionPaymentDescription(
  payment: SubscriptionPayment
): string {
  if (payment.PlanName.trim() !== "") {
    const operator = payment.Operator.replaceAll("_", " ").toLowerCase();
    return `${payment.PlanName} ${operator}`.trim();
  }
  return payment.Type.replaceAll(/recharge/gi, "payment")
    .replaceAll("_", " ")
    .toLowerCase();
}

function daysInRange(dateRange: BillingDateRange): string[] {
  const start = new Date(dateRange.startTime);
  const end = new Date(dateRange.endTime);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start > end
  ) {
    return [];
  }

  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  );
  const lastDay = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  while (cursor.getTime() <= lastDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export function buildDailyCostTrend(input: {
  dateRange: BillingDateRange;
  regions: RegionCostPoints[];
}): DailyCostTrend {
  const series: DailyCostTrendSeries[] = [
    { dataKey: "total", label: "Total" },
    ...input.regions.map((region, index) => ({
      dataKey: `region${index}`,
      label: region.label,
    })),
  ];

  const pointByDay = new Map<string, DailyCostTrendPoint>(
    daysInRange(input.dateRange).map((day) => [
      day,
      Object.fromEntries([
        ["label", DAY_LABEL_FORMATTER.format(new Date(`${day}T00:00:00.000Z`))],
        ...series.map(({ dataKey }) => [dataKey, 0]),
      ]) as DailyCostTrendPoint,
    ])
  );
  input.regions.forEach((region, index) => {
    for (const [timestampSeconds, rawAmount] of region.costPoints) {
      const date = new Date(timestampSeconds * 1000);
      const amount = Number(rawAmount);
      if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) {
        continue;
      }
      const point = pointByDay.get(date.toISOString().slice(0, 10));
      if (point == null) {
        continue;
      }
      point[`region${index}`] = Number(point[`region${index}`]) + amount;
      point.total = Number(point.total) + amount;
    }
  });
  return { points: [...pointByDay.values()], series };
}

export function buildMonthlyBillingTrend(input: {
  costPoints: BillingCostsSnapshot["costPoints"];
  dateRange: BillingDateRange;
  payments: SubscriptionPayment[];
}): MonthlyBillingTrendPoint[] {
  const points = monthsInRange(input.dateRange).map((month) => ({
    expenditureMicroUnits: 0,
    label: MONTH_LABEL_FORMATTER.format(month),
    month: monthKey(month),
    paymentMicroUnits: 0,
  }));
  const pointByMonth = new Map(points.map((point) => [point.month, point]));

  for (const [timestampSeconds, rawAmount] of input.costPoints) {
    const point = pointByMonth.get(monthKey(new Date(timestampSeconds * 1000)));
    const amount = Number(rawAmount);
    if (point != null && Number.isFinite(amount)) {
      point.expenditureMicroUnits += amount;
    }
  }
  for (const payment of input.payments) {
    if (!isPaidSubscriptionPayment(payment)) {
      continue;
    }
    const point = pointByMonth.get(monthKey(new Date(payment.Time)));
    if (point != null) {
      point.paymentMicroUnits += payment.Amount;
    }
  }
  return points;
}

/**
 * Region Cost attribution: the payment ledger is account-global, but every
 * Subscription Payment belongs to the region of its workspace, so a
 * region-scoped view must attribute before it aggregates. Membership in the
 * Current Region's workspace list (billing history plus subscription
 * workspaces, both region-scoped upstream) is the attribution test; other
 * regions' payments fall out.
 */
export function paymentsForRegionWorkspaces(
  payments: SubscriptionPayment[],
  workspaces: BillingWorkspace[]
): SubscriptionPayment[] {
  const workspaceIds = new Set(workspaces.map(([id]) => id));
  return payments.filter((payment) => workspaceIds.has(payment.Workspace));
}

export function buildWorkspaceCostBreakdown(input: {
  payments: SubscriptionPayment[];
  workspaceConsumptionMicroUnits: Record<string, number>;
  workspaces: BillingWorkspace[];
}): WorkspaceCostBreakdown[] {
  const subscriptionByWorkspace = new Map<string, number>();
  for (const payment of input.payments) {
    if (
      !isPaidSubscriptionPayment(payment) ||
      payment.Type.toUpperCase() !== "SUBSCRIPTION"
    ) {
      continue;
    }
    subscriptionByWorkspace.set(
      payment.Workspace,
      (subscriptionByWorkspace.get(payment.Workspace) ?? 0) + payment.Amount
    );
  }

  return input.workspaces.map(([id, name]) => {
    const consumptionMicroUnits = input.workspaceConsumptionMicroUnits[id] ?? 0;
    const subscriptionMicroUnits = subscriptionByWorkspace.get(id) ?? 0;
    return {
      consumptionMicroUnits,
      id,
      name,
      subscriptionMicroUnits,
      totalMicroUnits: consumptionMicroUnits + subscriptionMicroUnits,
    };
  });
}

async function requestBillingCosts<TSchema extends z.ZodType>(
  pathname: string,
  schema: TSchema,
  credentials: BillingCredentials,
  fetch: BillingFetch,
  body?: Record<string, unknown>
): Promise<z.infer<TSchema>> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load billing costs.",
    fetch,
  });
  const payload = await requestBillingJson(pathname, body);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Billing costs response is invalid.");
  }
  return parsed.data;
}

export async function loadBillingAppCosts(
  input: LoadBillingAppCostsInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingAppCostsPage> {
  const response = await requestBillingCosts(
    "/api/billing/app-costs",
    appCostsResponseSchema,
    { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fetch,
    {
      appName: input.appName,
      appType: input.appType,
      endTime: input.dateRange.endTime,
      namespace: input.namespace,
      orderID: "",
      page: input.page,
      pageSize: input.pageSize,
      startTime: input.dateRange.startTime,
    }
  );
  return {
    costs: response.app_costs.costs,
    currentPage: response.app_costs.current_page,
    totalPages: response.app_costs.total_pages,
    totalRecords: response.app_costs.total_records,
  };
}

export interface LoadBillingTrendInput extends BillingCredentials {
  dateRange: BillingDateRange;
}

export async function loadBillingDailyTrend(
  input: LoadBillingTrendInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<DailyCostTrend> {
  const credentials = {
    appToken: input.appToken,
    kubeconfig: input.kubeconfig,
  };
  const range = {
    endTime: input.dateRange.endTime,
    startTime: input.dateRange.startTime,
  };
  const [regions, costs] = await Promise.all([
    requestBillingCosts(
      "/api/billing/regions",
      regionsResponseSchema,
      credentials,
      fetch
    ),
    requestBillingCosts(
      "/api/billing/costs",
      costsResponseSchema,
      credentials,
      fetch,
      range
    ),
  ]);
  const region = regions.current;
  const regionLabel = region.name?.en ?? region.domain;
  return buildDailyCostTrend({
    dateRange: input.dateRange,
    regions: [{ costPoints: costs.data.costs, label: regionLabel }],
  });
}

export async function loadBillingMonthlyTrend(
  input: LoadBillingTrendInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<MonthlyBillingTrendPoint[]> {
  const credentials = {
    appToken: input.appToken,
    kubeconfig: input.kubeconfig,
  };
  const range = {
    endTime: input.dateRange.endTime,
    startTime: input.dateRange.startTime,
  };
  const [costs, payments, workspaces] = await Promise.all([
    requestBillingCosts(
      "/api/billing/costs",
      costsResponseSchema,
      credentials,
      fetch,
      range
    ),
    requestBillingCosts(
      "/api/billing/payments",
      paymentsResponseSchema,
      credentials,
      fetch,
      range
    ),
    requestBillingCosts(
      "/api/billing/workspaces",
      workspacesResponseSchema,
      credentials,
      fetch,
      { ...range, type: 0 }
    ),
  ]);
  return buildMonthlyBillingTrend({
    costPoints: costs.data.costs,
    dateRange: input.dateRange,
    payments: paymentsForRegionWorkspaces(payments.payments, workspaces.data),
  });
}

export async function loadBillingCostsBase(
  input: LoadBillingCostsBaseInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingCostsBaseSnapshot> {
  const credentials = {
    appToken: input.appToken,
    kubeconfig: input.kubeconfig,
  };
  const range = {
    endTime: input.dateRange.endTime,
    startTime: input.dateRange.startTime,
  };

  const [
    regions,
    appTypes,
    consumption,
    workspaceConsumption,
    workspaces,
    costs,
    payments,
  ] = await Promise.all([
    requestBillingCosts(
      "/api/billing/regions",
      regionsResponseSchema,
      credentials,
      fetch
    ),
    requestBillingCosts(
      "/api/billing/app-types",
      appTypesResponseSchema,
      credentials,
      fetch,
      {}
    ),
    requestBillingCosts(
      "/api/billing/consumption",
      consumptionResponseSchema,
      credentials,
      fetch,
      { ...range, appName: "", appType: "", namespace: "" }
    ),
    requestBillingCosts(
      "/api/billing/workspace-consumption",
      workspaceConsumptionResponseSchema,
      credentials,
      fetch,
      range
    ),
    requestBillingCosts(
      "/api/billing/workspaces",
      workspacesResponseSchema,
      credentials,
      fetch,
      { ...range, type: 0 }
    ),
    requestBillingCosts(
      "/api/billing/costs",
      costsResponseSchema,
      credentials,
      fetch,
      range
    ),
    requestBillingCosts(
      "/api/billing/payments",
      paymentsResponseSchema,
      credentials,
      fetch,
      range
    ),
  ]);
  return {
    appTypes: appTypes.data,
    costPoints: costs.data.costs,
    currentRegion: regions.current,
    payments: paymentsForRegionWorkspaces(payments.payments, workspaces.data),
    totalConsumptionMicroUnits: consumption.amount,
    workspaceConsumptionMicroUnits: workspaceConsumption.amount,
    workspaces: workspaces.data,
  };
}

// account-service answers a period with zero app cost records with a 500
// whose message ends in "no records found" — the same status a real fault
// gets. The message is the only signal that this is an empty page, not an
// outage, so a filtered-out period reads as empty instead of broken.
function isNoRecordsError(error: unknown): boolean {
  return (
    error instanceof BillingRequestError &&
    error.message.includes("no records found")
  );
}

export async function loadBillingAppOverview(
  input: LoadBillingAppOverviewInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingAppOverviewPage> {
  let appOverview: z.infer<typeof appOverviewResponseSchema>;
  try {
    appOverview = await requestBillingCosts(
      "/api/billing/app-overview",
      appOverviewResponseSchema,
      { appToken: input.appToken, kubeconfig: input.kubeconfig },
      fetch,
      {
        endTime: input.dateRange.endTime,
        startTime: input.dateRange.startTime,
        appName: "",
        appType: input.appType ?? "",
        namespace: input.workspace ?? "",
        page: input.page,
        pageSize: input.pageSize,
      }
    );
  } catch (error) {
    if (isNoRecordsError(error)) {
      return {
        appOverviews: [],
        totalAppOverviews: 0,
        totalAppOverviewPages: 1,
      };
    }
    throw error;
  }
  return {
    appOverviews: appOverview.data.overviews,
    totalAppOverviews: appOverview.data.total,
    totalAppOverviewPages: appOverview.data.totalPage,
  };
}

export async function loadBillingCosts(
  input: LoadBillingCostsInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingCostsSnapshot> {
  const [base, overview] = await Promise.all([
    loadBillingCostsBase(input, fetch),
    loadBillingAppOverview(input, fetch),
  ]);
  return { ...base, ...overview };
}
