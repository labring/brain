import { Quantity } from "@workspace/shared";
import { z } from "zod";

import {
  type BillingCredentials,
  type BillingFetch,
  BillingRequestError,
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
    invoiceId: string | null;
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
    changeKind?: "downgrade" | "upgrade" | null;
    description: string;
    id: string;
    isCurrent: boolean;
    limits?: SubscriptionPlanLimits;
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

interface BillingWorkspaceOperationContext extends BillingCredentials {
  regionDomain: string;
  workspace: string;
}

const subscriptionSchema = z.object({
  CancelAtPeriodEnd: z.boolean().default(false),
  CurrentPeriodEndAt: z.string().default(""),
  ExpireAt: z.string().nullable().optional(),
  InvoiceInfo: z
    .object({
      ID: z.string().trim().min(1).optional(),
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
      ID: z.string().optional(),
      NewPlanName: z.string().optional(),
      Operator: z.string().optional(),
      PayID: z.string().optional(),
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

const upgradeAmountResponseSchema = z.object({
  amount: z.number(),
  has_discount: z.boolean(),
  original_amount: z.number(),
  promotion_code: z.string(),
});

const subscriptionPaymentResponseSchema = z.object({
  invoiceID: z.string().optional(),
  payID: z.string().optional(),
  redirectUrl: z.string().optional(),
  success: z.boolean(),
});

const invoiceCancelResponseSchema = z.object({
  invoice_id: z.string(),
  message: z.string(),
  success: z.literal(true),
});

const downgradeQuotaResponseSchema = z.object({
  quota: z.object({
    used: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .optional()
      .default({}),
  }),
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
  credentials: BillingCredentials & { workspace: string },
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
      invoiceId: subscription.InvoiceInfo?.ID ?? null,
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
    plans: plans.map((plan) => {
      const isCurrent = plan.name === subscription.PlanName;
      let changeKind: "downgrade" | "upgrade" | null = null;
      if (!isCurrent && currentPlan != null) {
        const hasExplicitTransitions =
          currentPlan.upgradePlanNames !== undefined ||
          currentPlan.downgradePlanNames !== undefined;
        if (currentPlan.upgradePlanNames?.includes(plan.name)) {
          changeKind = "upgrade";
        } else if (currentPlan.downgradePlanNames?.includes(plan.name)) {
          changeKind = "downgrade";
        } else if (!hasExplicitTransitions && plan.order > currentPlan.order) {
          changeKind = "upgrade";
        } else if (!hasExplicitTransitions && plan.order < currentPlan.order) {
          changeKind = "downgrade";
        }
      }
      return {
        changeKind,
        description: plan.description,
        id: plan.id,
        isCurrent,
        limits: plan.limits ?? {},
        name: plan.name,
        order: plan.order,
        priceMicroUnits: plan.monthlyPriceMicroUnits,
        resources: plan.resources.map(({ label, value }) => ({ label, value })),
      };
    }),
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

export interface SubscriptionUpgradeQuote {
  amountMicroUnits: number;
  discountMicroUnits: number;
  hasDiscount: boolean;
  originalAmountMicroUnits: number;
  promotionCode: string;
}

export type SubscriptionPromotionCodeErrorKind =
  | "exhausted"
  | "expired"
  | "unknown";

const PROMOTION_CODE_ERROR_MESSAGES: Record<
  SubscriptionPromotionCodeErrorKind,
  string
> = {
  exhausted: "This promotion code has already been fully redeemed.",
  expired: "This promotion code has expired.",
  unknown: "This promotion code was not found.",
};

export class SubscriptionPromotionCodeError extends Error {
  readonly kind: SubscriptionPromotionCodeErrorKind;

  constructor(kind: SubscriptionPromotionCodeErrorKind) {
    super(PROMOTION_CODE_ERROR_MESSAGES[kind]);
    this.name = "SubscriptionPromotionCodeError";
    this.kind = kind;
  }
}

export interface SubscriptionPlanCheckout {
  invoiceId: string | null;
  payId: string | null;
  redirectUrl: string | null;
  success: boolean;
}

export async function createSubscriptionPlanPayment(
  input: BillingWorkspaceOperationContext & {
    operator: "downgraded" | "renewed" | "upgraded";
    planName: string;
    promotionCode?: string;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<SubscriptionPlanCheckout> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not create the subscription payment.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  const payload = await requestBillingJson("/api/billing/subscription/pay", {
    operator: input.operator,
    payMethod: "stripe",
    period: "1m",
    planName: input.planName,
    ...(input.promotionCode == null
      ? {}
      : { promotionCode: input.promotionCode }),
    regionDomain: input.regionDomain,
    workspace: input.workspace,
  });
  const checkout = subscriptionPaymentResponseSchema.parse(payload);

  return {
    invoiceId: checkout.invoiceID ?? null,
    payId: checkout.payID ?? null,
    redirectUrl: checkout.redirectUrl ?? null,
    success: checkout.success,
  };
}

export async function cancelSubscriptionInvoice(
  input: BillingWorkspaceOperationContext & { invoiceId: string },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<void> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not cancel the unpaid upgrade invoice.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  const payload = await requestBillingJson(
    "/api/billing/subscription/invoice-cancel",
    {
      invoiceID: input.invoiceId,
      regionDomain: input.regionDomain,
      workspace: input.workspace,
    }
  );
  invoiceCancelResponseSchema.parse(payload);
}

export interface SubscriptionTransactionStatus {
  id: string;
  payId: string;
  planName: string;
  status: string;
}

export async function loadSubscriptionTransactionStatus(
  input: BillingWorkspaceOperationContext,
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<SubscriptionTransactionStatus | null> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not check the subscription payment.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  const payload = await requestBillingJson(
    "/api/billing/subscription/last-transaction",
    {
      regionDomain: input.regionDomain,
      workspace: input.workspace,
    }
  );
  const transaction =
    transactionResponseSchema.parse(payload).transaction ?? null;
  if (transaction == null) {
    return null;
  }
  return {
    id: transaction.ID ?? "",
    payId: transaction.PayID ?? "",
    planName: transaction.NewPlanName ?? "",
    status: transaction.Status?.trim().toLowerCase() ?? "",
  };
}

type SubscriptionPlanLimitType =
  | "cpu"
  | "gpu"
  | "memory"
  | "nodeport"
  | "storage"
  | "traffic";

export type SubscriptionPlanLimits = Partial<
  Record<SubscriptionPlanLimitType, string>
>;

export interface SubscriptionDowngradeCheck {
  allowed: boolean;
  exceededResources: Array<{
    label: string;
    limit: string;
    used: string;
  }>;
}

const DOWNGRADE_QUOTA_RESOURCES: ReadonlyArray<{
  key: string;
  label: string;
  type: SubscriptionPlanLimitType;
}> = [
  { key: "limits.cpu", label: "CPU", type: "cpu" },
  { key: "limits.memory", label: "Memory", type: "memory" },
  { key: "requests.storage", label: "Storage", type: "storage" },
  { key: "traffic", label: "Traffic", type: "traffic" },
  { key: "limits.nvidia.com/gpu", label: "GPU", type: "gpu" },
  { key: "services.nodeports", label: "Public ports", type: "nodeport" },
];

function displayDowngradeQuantity(
  value: Quantity,
  type: SubscriptionPlanLimitType
): string {
  return value.formatForDisplay({
    format:
      type === "memory" || type === "storage" || type === "traffic"
        ? "BinarySI"
        : "DecimalSI",
  });
}

export async function checkSubscriptionDowngrade(
  input: BillingWorkspaceOperationContext & {
    limits: SubscriptionPlanLimits;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<SubscriptionDowngradeCheck> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not check workspace usage for downgrade.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  const payload = await requestBillingJson("/api/billing/workspace-quota", {
    workspace: input.workspace,
  });
  const used = downgradeQuotaResponseSchema.parse(payload).quota.used;
  const exceededResources = DOWNGRADE_QUOTA_RESOURCES.flatMap((resource) => {
    const limitValue = input.limits[resource.type];
    const usedValue = used[resource.key];
    if (limitValue == null || usedValue == null) {
      return [];
    }
    const limit = Quantity.fromJSON(limitValue);
    const consumed = Quantity.fromJSON(usedValue);
    if (consumed.cmp(limit) <= 0) {
      return [];
    }
    return [
      {
        label: resource.label,
        limit: displayDowngradeQuantity(limit, resource.type),
        used: displayDowngradeQuantity(consumed, resource.type),
      },
    ];
  });

  return {
    allowed: exceededResources.length === 0,
    exceededResources,
  };
}

export async function loadSubscriptionUpgradeQuote(
  input: BillingWorkspaceOperationContext & {
    planName: string;
    promotionCode?: string;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<SubscriptionUpgradeQuote> {
  const requestBillingJson = createBillingJsonRequester({
    credentials: { appToken: input.appToken, kubeconfig: input.kubeconfig },
    fallbackErrorMessage: "Could not calculate the prorated upgrade amount.",
    fetch: dependencies.fetch ?? globalThis.fetch,
  });
  let payload: unknown;
  try {
    payload = await requestBillingJson(
      "/api/billing/subscription/upgrade-amount",
      {
        operator: "upgraded",
        payMethod: "stripe",
        period: "1m",
        planName: input.planName,
        ...(input.promotionCode == null
          ? {}
          : { promotionCode: input.promotionCode }),
        regionDomain: input.regionDomain,
        workspace: input.workspace,
      }
    );
  } catch (error) {
    if (input.promotionCode != null && error instanceof BillingRequestError) {
      const kind = {
        404: "unknown",
        409: "exhausted",
        410: "expired",
      }[error.status] as SubscriptionPromotionCodeErrorKind | undefined;
      if (kind != null) {
        throw new SubscriptionPromotionCodeError(kind);
      }
    }
    throw error;
  }
  const quote = upgradeAmountResponseSchema.parse(payload);

  return {
    amountMicroUnits: quote.amount,
    discountMicroUnits: quote.has_discount
      ? Math.max(0, quote.original_amount - quote.amount)
      : 0,
    hasDiscount: quote.has_discount,
    originalAmountMicroUnits: quote.original_amount,
    promotionCode: quote.promotion_code,
  };
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
