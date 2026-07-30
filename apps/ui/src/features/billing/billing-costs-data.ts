import { z } from "zod";
import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

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

type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

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

export interface LoadBillingCostsInput {
  appToken: string;
  dateRange: BillingDateRange;
  kubeconfig: string;
  page: number;
  pageSize: number;
  workspace: string | null;
}

export interface LoadBillingAppCostsInput {
  appName: string;
  appToken: string;
  appType: string;
  dateRange: BillingDateRange;
  kubeconfig: string;
  namespace: string;
  page: number;
  pageSize: number;
}

export type BillingWorkspace = z.infer<typeof workspaceSchema>;
export type BillingAppOverview = z.infer<typeof appOverviewSchema>;
export type SubscriptionPayment = z.infer<typeof paymentSchema>;
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

function responseErrorMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  return "Could not load billing costs.";
}

async function postBilling<TSchema extends z.ZodType>(
  pathname: string,
  body: Record<string, unknown>,
  schema: TSchema,
  credentials: { appToken: string; kubeconfig: string },
  fetch: BillingFetch
): Promise<z.infer<TSchema>> {
  const response = await fetch(pathname, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: {
      ...personalResourceAuthHeaders(credentials),
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(payload));
  }
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
  const response = await postBilling(
    "/api/billing/app-costs",
    {
      appName: input.appName,
      appType: input.appType,
      endTime: input.dateRange.endTime,
      namespace: input.namespace,
      orderID: "",
      page: input.page,
      pageSize: input.pageSize,
      startTime: input.dateRange.startTime,
    },
    appCostsResponseSchema,
    { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fetch
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
    appTypes,
    consumption,
    workspaceConsumption,
    workspaces,
    appOverview,
    costs,
    payments,
  ] = await Promise.all([
    postBilling(
      "/api/billing/app-types",
      {},
      appTypesResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/consumption",
      { ...range, appName: "", appType: "", namespace: "" },
      consumptionResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/workspace-consumption",
      range,
      workspaceConsumptionResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/workspaces",
      { ...range, type: 0 },
      workspacesResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/app-overview",
      {
        ...range,
        appName: "",
        appType: "",
        namespace: input.workspace ?? "",
        page: input.page,
        pageSize: input.pageSize,
      },
      appOverviewResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/costs",
      range,
      costsResponseSchema,
      credentials,
      fetch
    ),
    postBilling(
      "/api/billing/payments",
      range,
      paymentsResponseSchema,
      credentials,
      fetch
    ),
  ]);

  return {
    appOverviews: appOverview.data.overviews,
    appTypes: appTypes.data,
    costPoints: costs.data.costs,
    payments: payments.payments,
    totalAppOverviews: appOverview.data.total,
    totalAppOverviewPages: appOverview.data.totalPage,
    totalConsumptionMicroUnits: consumption.amount,
    workspaceConsumptionMicroUnits: workspaceConsumption.amount,
    workspaces: workspaces.data,
  };
}
