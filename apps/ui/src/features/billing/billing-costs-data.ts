import { z } from "zod";
import {
  type BillingCredentials,
  type BillingFetch,
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
const appOverviewResponseSchema = z.object({
  data: z.object({
    overviews: z.array(appOverviewSchema),
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
const regionsResponseSchema = z.object({ regions: z.array(regionSchema) });
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
    costs: z.array(appCostSchema).default([]),
    current_page: z.number().default(1),
    total_pages: z.number().default(1),
    total_records: z.number().default(0),
  }),
});

export interface BillingDateRange {
  endTime: string;
  startTime: string;
}

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

export interface LoadBillingCostsInput extends BillingCredentials {
  dateRange: BillingDateRange;
  page: number;
  pageSize: number;
  workspace: string | null;
}

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

export interface BillingCostsSnapshot {
  appOverviews: BillingAppOverview[];
  appTypes: Record<string, string>;
  costPoints: [number, string | number][];
  payments: SubscriptionPayment[];
  region: BillingRegion | null;
  totalAppOverviewPages: number;
  totalAppOverviews: number;
  totalConsumptionMicroUnits: number;
  workspaceConsumptionMicroUnits: Record<string, number>;
  workspaces: BillingWorkspace[];
}

export interface MonthlyBillingTrendPoint {
  expenditureMicroUnits: number;
  label: string;
  month: string;
  paymentMicroUnits: number;
}

export interface DailyExpenditurePoint {
  expenditureMicroUnits: number;
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
  const mappedAppType = appTypes[rawAppType];
  return {
    queryAppType: mappedAppType ?? rawAppType,
    typeName: mappedAppType ?? `App type ${rawAppType}`,
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

export function buildDailyExpenditureTrend(
  costPoints: BillingCostsSnapshot["costPoints"]
): DailyExpenditurePoint[] {
  const amountByDay = new Map<string, number>();
  for (const [timestampSeconds, rawAmount] of costPoints) {
    const date = new Date(timestampSeconds * 1000);
    const amount = Number(rawAmount);
    if (Number.isNaN(date.getTime()) || !Number.isFinite(amount)) {
      continue;
    }
    const day = date.toISOString().slice(0, 10);
    amountByDay.set(day, (amountByDay.get(day) ?? 0) + amount);
  }
  return [...amountByDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, expenditureMicroUnits]) => ({
      expenditureMicroUnits,
      label: DAY_LABEL_FORMATTER.format(new Date(`${day}T00:00:00.000Z`)),
    }));
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

export async function loadBillingCosts(
  input: LoadBillingCostsInput,
  fetch: BillingFetch = globalThis.fetch
): Promise<BillingCostsSnapshot> {
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
    appOverview,
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
      "/api/billing/app-overview",
      appOverviewResponseSchema,
      credentials,
      fetch,
      {
        ...range,
        appName: "",
        appType: "",
        namespace: input.workspace ?? "",
        page: input.page,
        pageSize: input.pageSize,
      }
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
  const region = regions.regions[0];
  if (region == null) {
    throw new Error("Billing region is unavailable.");
  }

  return {
    appOverviews: appOverview.data.overviews,
    appTypes: appTypes.data,
    costPoints: costs.data.costs,
    payments: payments.payments,
    region,
    totalAppOverviews: appOverview.data.total,
    totalAppOverviewPages: appOverview.data.totalPage,
    totalConsumptionMicroUnits: consumption.amount,
    workspaceConsumptionMicroUnits: workspaceConsumption.amount,
    workspaces: workspaces.data,
  };
}
