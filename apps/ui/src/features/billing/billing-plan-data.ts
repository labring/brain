import { z } from "zod";

import {
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  billingPlansResponseSchema,
  normalizeBillingPlan,
} from "./billing-plan-catalog";

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

interface BillingPlanLoaderDependencies {
  fetch?: BillingFetch;
  now?: () => Date;
}

interface BillingWorkspaceOperationContext {
  appToken: string;
  kubeconfig: string;
  regionDomain: string;
  workspace: string;
}

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

const cardManagementResponseSchema = z.object({
  success: z.boolean(),
  url: z.string().optional(),
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

const DAYS_31_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

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
  const requestBillingJson = createBillingJsonRequester({
    credentials: auth,
    fallbackErrorMessage: "Could not load billing plan data.",
    fetch,
  });

  const regions = regionsResponseSchema.parse(
    await requestBillingJson("/api/billing/regions")
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
    requestBillingJson("/api/billing/plans"),
    requestBillingJson("/api/billing/subscription", workspaceRequest),
    requestBillingJson(
      "/api/billing/subscription/last-transaction",
      workspaceRequest
    ),
    requestBillingJson("/api/billing/subscriptions"),
    requestBillingJson("/api/billing/payments", {
      endTime,
      startTime,
    }),
    requestBillingJson("/api/billing/workspaces", {
      endTime,
      startTime,
    }),
    requestBillingJson("/api/billing/card", workspaceRequest),
  ]);

  const plans = billingPlansResponseSchema
    .parse(plansPayload)
    .plans.map(normalizeBillingPlan)
    .sort((left, right) => left.order - right.order);
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
  const currentPlan = plans.find((plan) => plan.name === subscription.PlanName);
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
      priceMicroUnits: currentPlan?.monthlyPriceMicroUnits ?? 0,
      regionDomain: subscription.RegionDomain || region.domain,
      resources:
        currentPlan?.resources.map(({ label, value }) => ({ label, value })) ??
        [],
      workspace: subscription.Workspace,
    },
    pendingUpgrade,
    plans: plans.map((plan) => ({
      description: plan.description,
      id: plan.id,
      isCurrent: plan.name === subscription.PlanName,
      name: plan.name,
      order: plan.order,
      priceMicroUnits: plan.monthlyPriceMicroUnits,
      resources: plan.resources.map(({ label, value }) => ({ label, value })),
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
  input: BillingWorkspaceOperationContext & {
    operator: SubscriptionLifecycleAction;
    payMethod: "balance" | "stripe";
    planName: string;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<void> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not update the billing plan.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  await requestBillingJson("/api/billing/subscription/pay", {
    operator: input.operator,
    payMethod: input.payMethod,
    planName: input.planName,
    regionDomain: input.regionDomain,
    workspace: input.workspace,
  });
}

export async function createBillingCardManagementSession(
  input: BillingWorkspaceOperationContext,
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<string> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not manage the billing card.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  const payload = await requestBillingJson("/api/billing/card/manage", {
    regionDomain: input.regionDomain,
    workspace: input.workspace,
  });
  const session = cardManagementResponseSchema.parse(payload);
  if (!session.success || session.url == null || session.url.trim() === "") {
    throw new Error(
      "The billing service did not create a card management session."
    );
  }

  const managementUrl = new URL(session.url);
  if (managementUrl.protocol !== "https:") {
    throw new Error(
      "The billing service returned an invalid card management URL."
    );
  }
  return managementUrl.toString();
}
