import { Quantity } from "@workspace/shared";
import { z } from "zod";

import { personalResourceAuthHeaders } from "@/lib/personal-resource-headers";

export type SubscriptionLifecycle =
  | "active"
  | "cancelling"
  | "payment-due"
  | "pending-upgrade";

export interface BillingPlanResource {
  label: string;
  value: string;
}

export interface BillingPlanSnapshot {
  card: { brand: string; last4: string } | null;
  current: {
    canManage: boolean;
    cancelAtPeriodEnd: boolean;
    currentPeriodEndAt: string;
    expireAt: string | null;
    invoicePaymentUrl: string | null;
    lifecycle: SubscriptionLifecycle;
    payMethod: "balance" | "stripe";
    planName: string;
    priceMicroUnits: number;
    regionDomain: string;
    resources: BillingPlanResource[];
    workspace: string;
  };
  pendingUpgrade: { planName: string; startsAt: string } | null;
  plans: Array<{
    description: string;
    id: string;
    isCurrent: boolean;
    name: string;
    order: number;
    priceMicroUnits: number;
    resources: BillingPlanResource[];
  }>;
  workspaces: Array<{
    id: string;
    isCurrent: boolean;
    lifecycle: SubscriptionLifecycle;
    name: string;
    planName: string;
    recentSpendMicroUnits: number;
  }>;
}

export type SubscriptionLifecycleAction = "canceled" | "resumed";

type BillingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

interface BillingPlanLoaderDependencies {
  fetch?: BillingFetch;
  now?: () => Date;
}

const resourceValueSchema = z.union([z.string(), z.number()]);
const planSchema = z.object({
  AIQuota: z.number().default(0),
  Description: z.string().default(""),
  ID: z.string().min(1),
  MaxResources: z.union([
    z.string(),
    z.record(z.string(), resourceValueSchema),
  ]),
  Name: z.string().min(1),
  Order: z.number().default(0),
  Prices: z
    .array(
      z.object({
        BillingCycle: z.string(),
        Price: z.number(),
      })
    )
    .default([]),
  Tags: z.array(z.string()).default([]),
  Traffic: z.number().default(0),
});
const plansResponseSchema = z.object({ plans: z.array(planSchema) });

const subscriptionSchema = z.object({
  CancelAtPeriodEnd: z.boolean().default(false),
  CurrentPeriodEndAt: z.string().default(""),
  ExpireAt: z.string().nullable().optional(),
  InvoiceInfo: z
    .object({
      PaymentUrl: z.string().trim().min(1),
    })
    .optional(),
  PayMethod: z.string().default("stripe"),
  PlanName: z.string().default("PAYG"),
  RegionDomain: z.string().default(""),
  Status: z.string().default(""),
  Workspace: z.string().min(1),
  role: z.enum(["MANAGER", "DEVELOPER", "OWNER"]).optional(),
  type: z.enum(["SUBSCRIPTION", "PAYG"]).optional(),
});
const subscriptionResponseSchema = z.object({
  subscription: subscriptionSchema,
});
const subscriptionsResponseSchema = z.object({
  subscriptions: z.array(subscriptionSchema),
});

const transactionResponseSchema = z.object({
  transaction: z
    .object({
      NewPlanName: z.string().optional(),
      Operator: z.string().optional(),
      StartAt: z.string().optional(),
      Status: z.string().optional(),
    })
    .optional(),
});

const cardResponseSchema = z.object({
  payment_method: z
    .object({
      card: z.object({
        brand: z.string(),
        last4: z.string(),
      }),
    })
    .nullable(),
});

const paymentSchema = z.object({
  Amount: z.number(),
  Workspace: z.string(),
});
const paymentsResponseSchema = z.object({
  payments: z.array(paymentSchema),
});

const regionsResponseSchema = z.object({
  regions: z.array(
    z.object({
      domain: z.string().trim().min(1),
      uid: z.string().trim().min(1),
    })
  ),
});

const workspacesResponseSchema = z.object({
  data: z.array(z.tuple([z.string().min(1), z.string()])),
});

const RESOURCE_LABELS: Record<string, string> = {
  cpu: "CPU",
  memory: "Memory",
  nodeports: "Nodeports",
  storage: "Storage",
};
const RESOURCE_ORDER = ["cpu", "memory", "storage", "nodeports"];
const DAYS_31_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

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
  return "Could not load billing plan data.";
}

async function requestBillingJson(
  fetch: BillingFetch,
  credentials: { appToken: string; kubeconfig: string },
  url: string,
  body?: unknown
): Promise<unknown> {
  const headers = new Headers(personalResourceAuthHeaders(credentials));
  const init: RequestInit = {
    cache: "no-store",
    headers,
    method: body === undefined ? "GET" : "POST",
  };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(responseErrorMessage(payload));
  }
  return payload;
}

function parseMaxResources(
  input: z.infer<typeof planSchema>["MaxResources"]
): Record<string, string | number> {
  if (typeof input !== "string") {
    return input;
  }
  try {
    const parsed = z
      .record(z.string(), resourceValueSchema)
      .safeParse(JSON.parse(input || "{}"));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function displayQuantity(value: string | number): string {
  try {
    return Quantity.fromJSON(value).formatForDisplay({ format: "BinarySI" });
  } catch {
    return String(value);
  }
}

function planResources(
  plan: z.infer<typeof planSchema>
): BillingPlanResource[] {
  const maxResources = parseMaxResources(plan.MaxResources);
  const resourceKeys = Object.keys(maxResources).sort((left, right) => {
    const leftIndex = RESOURCE_ORDER.indexOf(left);
    const rightIndex = RESOURCE_ORDER.indexOf(right);
    return (
      (leftIndex === -1 ? RESOURCE_ORDER.length : leftIndex) -
      (rightIndex === -1 ? RESOURCE_ORDER.length : rightIndex)
    );
  });
  const resources = resourceKeys.map((key) => ({
    label: RESOURCE_LABELS[key] ?? key,
    value: displayQuantity(maxResources[key] ?? ""),
  }));

  if (plan.Traffic > 0) {
    const bytes = BigInt(Math.round(plan.Traffic * 1024 * 1024));
    resources.push({
      label: "Traffic",
      value: Quantity.newQuantity(bytes, "BinarySI").formatForDisplay({
        format: "BinarySI",
      }),
    });
  }
  if (plan.AIQuota > 0) {
    resources.push({ label: "AI quota", value: String(plan.AIQuota) });
  }
  return resources;
}

function monthlyPrice(plan: z.infer<typeof planSchema> | undefined): number {
  return plan?.Prices.find((price) => price.BillingCycle === "1m")?.Price ?? 0;
}

function normalizedPayMethod(value: string): "balance" | "stripe" {
  return value.trim().toLowerCase() === "balance" ? "balance" : "stripe";
}

function subscriptionLifecycle(input: {
  cancelAtPeriodEnd: boolean;
  hasPendingUpgrade?: boolean;
  planName: string;
  status: string;
}): SubscriptionLifecycle {
  if (
    input.cancelAtPeriodEnd &&
    input.planName.trim().toLowerCase() !== "free"
  ) {
    return "cancelling";
  }
  if (input.status.trim().toLowerCase() === "debt") {
    return "payment-due";
  }
  if (input.hasPendingUpgrade) {
    return "pending-upgrade";
  }
  return "active";
}

function pendingUpgradeFromTransaction(
  transaction: z.infer<typeof transactionResponseSchema>["transaction"]
): BillingPlanSnapshot["pendingUpgrade"] {
  if (
    transaction?.Operator?.toLowerCase() !== "upgraded" ||
    transaction.Status?.toLowerCase() !== "pending" ||
    !transaction.NewPlanName ||
    !transaction.StartAt
  ) {
    return null;
  }
  return {
    planName: transaction.NewPlanName,
    startsAt: transaction.StartAt,
  };
}

export async function loadBillingPlanSnapshot(
  credentials: {
    appToken: string;
    kubeconfig: string;
    workspace: string;
  },
  dependencies: BillingPlanLoaderDependencies = {}
): Promise<BillingPlanSnapshot> {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now?.() ?? new Date();
  const auth = {
    appToken: credentials.appToken,
    kubeconfig: credentials.kubeconfig,
  };

  const regions = regionsResponseSchema.parse(
    await requestBillingJson(fetch, auth, "/api/billing/regions")
  ).regions;
  const region = regions[0];
  if (region == null) {
    throw new Error("Billing region is unavailable.");
  }

  const startTime = new Date(
    now.getTime() - DAYS_31_IN_MILLISECONDS
  ).toISOString();
  const endTime = now.toISOString();
  const workspaceRequest = {
    regionDomain: region.domain,
    workspace: credentials.workspace,
  };

  const [
    plansPayload,
    subscriptionPayload,
    transactionPayload,
    subscriptionsPayload,
    paymentsPayload,
    workspacesPayload,
    cardPayload,
  ] = await Promise.all([
    requestBillingJson(fetch, auth, "/api/billing/plans"),
    requestBillingJson(
      fetch,
      auth,
      "/api/billing/subscription",
      workspaceRequest
    ),
    requestBillingJson(
      fetch,
      auth,
      "/api/billing/subscription/last-transaction",
      workspaceRequest
    ),
    requestBillingJson(fetch, auth, "/api/billing/subscriptions"),
    requestBillingJson(fetch, auth, "/api/billing/payments", {
      endTime,
      startTime,
    }),
    requestBillingJson(fetch, auth, "/api/billing/workspaces", {
      endTime,
      startTime,
    }),
    requestBillingJson(fetch, auth, "/api/billing/card", workspaceRequest),
  ]);

  const plans = plansResponseSchema
    .parse(plansPayload)
    .plans.slice()
    .sort((left, right) => left.Order - right.Order);
  const subscription =
    subscriptionResponseSchema.parse(subscriptionPayload).subscription;
  const transaction =
    transactionResponseSchema.parse(transactionPayload).transaction;
  const subscriptions =
    subscriptionsResponseSchema.parse(subscriptionsPayload).subscriptions;
  const payments = paymentsResponseSchema.parse(paymentsPayload).payments;
  const workspaces = workspacesResponseSchema.parse(workspacesPayload).data;
  const paymentMethod = cardResponseSchema.parse(cardPayload).payment_method;
  const pendingUpgrade = pendingUpgradeFromTransaction(transaction);
  const currentPlan = plans.find((plan) => plan.Name === subscription.PlanName);
  const subscriptionByWorkspace = new Map(
    subscriptions.map((item) => [item.Workspace, item])
  );
  const spendByWorkspace = new Map<string, number>();
  for (const payment of payments) {
    spendByWorkspace.set(
      payment.Workspace,
      (spendByWorkspace.get(payment.Workspace) ?? 0) + payment.Amount
    );
  }

  return {
    card:
      paymentMethod == null
        ? null
        : {
            brand: paymentMethod.card.brand,
            last4: paymentMethod.card.last4,
          },
    current: {
      canManage: subscription.role === "OWNER" || subscription.type === "PAYG",
      cancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
      currentPeriodEndAt: subscription.CurrentPeriodEndAt,
      expireAt: subscription.ExpireAt ?? null,
      invoicePaymentUrl: subscription.InvoiceInfo?.PaymentUrl ?? null,
      lifecycle: subscriptionLifecycle({
        cancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
        hasPendingUpgrade: pendingUpgrade != null,
        planName: subscription.PlanName,
        status: subscription.Status,
      }),
      payMethod: normalizedPayMethod(subscription.PayMethod),
      planName: subscription.PlanName,
      priceMicroUnits: monthlyPrice(currentPlan),
      regionDomain: subscription.RegionDomain || region.domain,
      resources: currentPlan == null ? [] : planResources(currentPlan),
      workspace: subscription.Workspace,
    },
    pendingUpgrade,
    plans: plans.map((plan) => ({
      description: plan.Description,
      id: plan.ID,
      isCurrent: plan.Name === subscription.PlanName,
      name: plan.Name,
      order: plan.Order,
      priceMicroUnits: monthlyPrice(plan),
      resources: planResources(plan),
    })),
    workspaces: workspaces.map(([id, name]) => {
      const item = subscriptionByWorkspace.get(id);
      const planName = item?.PlanName ?? "PAYG";
      return {
        id,
        isCurrent: id === credentials.workspace,
        lifecycle: subscriptionLifecycle({
          cancelAtPeriodEnd: item?.CancelAtPeriodEnd ?? false,
          planName,
          status: item?.Status ?? "",
        }),
        name: name.trim() || id,
        planName,
        recentSpendMicroUnits: spendByWorkspace.get(id) ?? 0,
      };
    }),
  };
}

export async function updateSubscriptionLifecycle(
  input: {
    appToken: string;
    kubeconfig: string;
    operator: SubscriptionLifecycleAction;
    payMethod: "balance" | "stripe";
    planName: string;
    regionDomain: string;
    workspace: string;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<void> {
  await requestBillingJson(
    dependencies.fetch ?? globalThis.fetch,
    { appToken: input.appToken, kubeconfig: input.kubeconfig },
    "/api/billing/subscription/pay",
    {
      operator: input.operator,
      payMethod: input.payMethod,
      planName: input.planName,
      regionDomain: input.regionDomain,
      workspace: input.workspace,
    }
  );
}
