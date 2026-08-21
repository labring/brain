import { Quantity } from "@workspace/shared";
import { z } from "zod";

import { isActiveFreeTrialSubscription } from "@/lib/account-service/free-trial-core";

import {
  type BillingCredentials,
  type BillingFetch,
  BillingRequestError,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  invalidPendingSubscriptionUpgradeErrorSchema,
  type PendingSubscriptionUpgradePayload,
  pendingSubscriptionUpgradeErrorSchema,
} from "./billing-pending-upgrade";
import {
  type BillingPlanResourceType,
  billingPlansResponseSchema,
  normalizeBillingPlan,
} from "./billing-plan-catalog";

export type SubscriptionLifecycle =
  | "active"
  | "cancelling"
  | "payment-due"
  | "pending-upgrade"
  | "unavailable";

export type BillingDataAvailability = "available" | "unavailable";

/**
 * What the current period end means for this subscription — which decides
 * how the plan surfaces voice it (AIM-254):
 * - "renewal": a renewal is coming; the date is the Renewal Time and the
 *   quota-reset moment.
 * - "expiry": a Free plan's period end is the plan's expiry — nothing renews
 *   or resets, so surfaces say "expires"/"ends".
 * - "silent": the date is a suspension/deletion deadline owned by the
 *   destructive warning banner; the date fields stay blank.
 */
export type PeriodEndVoice = "expiry" | "renewal" | "silent";

export function subscriptionLifecycleAllowsBillingActions(
  lifecycle: SubscriptionLifecycle
): boolean {
  return lifecycle !== "unavailable";
}

/**
 * Escalation stage of the destructive subscription warning, following the
 * platform's expiry pipeline: a cancelled subscription still inside its paid
 * period ("cancelling"), an expired one whose workspace is suspended
 * ("expired"), and one whose deletion window has opened
 * ("deletion-imminent").
 */
export type SubscriptionWarningStage =
  | "cancelling"
  | "deletion-imminent"
  | "expired";

export interface BillingPlanResource {
  label: string;
  type?: BillingPlanResourceType;
  value: string;
}

export interface BillingPlanSnapshot {
  availability: {
    card: BillingDataAvailability;
    transaction: BillingDataAvailability;
    workspaces: BillingDataAvailability;
  };
  card: {
    brand: string;
    expMonth?: number | null;
    expYear?: number | null;
    last4: string;
  } | null;
  current: {
    canManage: boolean;
    cancelAtPeriodEnd: boolean;
    currentPeriodEndAt: string;
    invoiceId: string | null;
    invoicePaymentUrl: string | null;
    /**
     * Active Free Trial (ADR-0065): Free plan in normal standing. The Plan
     * view's free-allowance card renders under exactly this predicate —
     * paid, PAYG, PAUSED, and DEBT Free never render it.
     */
    isActiveFreeTrial: boolean;
    isPayg: boolean;
    lifecycle: SubscriptionLifecycle;
    payMethod: "balance" | "stripe";
    periodEndVoice: PeriodEndVoice;
    planName: string;
    priceMicroUnits: number;
    regionDomain: string;
    resources: BillingPlanResource[];
    /**
     * The warning stage's next deadline: the suspension date (period end)
     * while cancelling, the derived resource-deletion date once expired.
     * Set only while `warningStage` is.
     */
    warningDeadlineAt: string | null;
    warningStage: SubscriptionWarningStage | null;
    workspace: string;
  };
  pendingDowngrade: { planName: string; startsAt: string } | null;
  pendingUpgrade: { planName: string; startsAt: string } | null;
  plans: Array<{
    changeKind?: "contact" | "downgrade" | "subscribe" | "upgrade" | null;
    description: string;
    hasMonthlyPrice?: boolean;
    id: string;
    isCurrent: boolean;
    limits?: SubscriptionPlanLimits;
    name: string;
    order: number;
    originalPriceMicroUnits?: number;
    priceMicroUnits: number;
    resources: BillingPlanResource[];
    tags?: string[];
  }>;
  workspaces: Array<{
    id: string;
    isCurrent: boolean;
    lifecycle: SubscriptionLifecycle;
    name: string;
    planName: string;
    priceMicroUnits: number | null;
    renewalAt: string | null;
  }>;
}

export type SubscriptionLifecycleAction = "canceled" | "resumed";

export type SubscriptionLifecycleOutcome =
  | { ok: true }
  | { ok: false; message: string };

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
      // Upstream tags every InvoiceInfo field `omitempty` and forwards draft
      // invoices, where Stripe has not yet minted a hosted payment URL.
      PaymentUrl: z.string().trim().min(1).optional(),
    })
    .optional(),
  PayMethod: z.string().default("stripe"),
  PlanName: z.string().default("PAYG"),
  RegionDomain: z.string().default(""),
  Status: z.string().default(""),
  // Absent for PAYG workspaces: the upstream embeds a nil subscription and
  // serializes only `{"type":"PAYG"}`.
  Workspace: z.string().default(""),
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
        exp_month: z.number().optional(),
        exp_year: z.number().optional(),
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

// The regions route marks the deployment's own region; the catalog's order
// carries no meaning, so loaders read `current` and never an index.
const regionsResponseSchema = z.object({
  current: z.object({
    domain: z.string().trim().min(1),
    uid: z.string().trim().min(1),
  }),
});

const workspacesResponseSchema = z.object({
  data: z.array(z.tuple([z.string().min(1), z.string()])),
});

const DAYS_31_IN_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;

// Mirror of the platform's workspace-subscription expiry pipeline: resources
// are finally deleted 14 days after the subscription expires. The upstream
// does not report a deletion date, so the client derives it from expiry for
// the post-expiry warning stages; see
// docs/adr/0063-derive-resource-deletion-dates-client-side.md for when this
// constant must be replaced by an upstream field.
const RESOURCE_DELETION_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

// Upstream subscription statuses that mean the subscription has expired and
// entered the deletion pipeline; only the first still precedes deletion by
// the full grace window.
const DEBT_STATUSES = new Set([
  "debt",
  "debt_pre_deletion",
  "debt_final_deletion",
]);

function normalizedPayMethod(value: string): "balance" | "stripe" {
  return value.trim().toLowerCase() === "balance" ? "balance" : "stripe";
}

// A DELETED record is not a Workspace Subscription — the platform treats the
// workspace as Pay-As-You-Go that may subscribe anew. Callers normalize such
// records to the PAYG shape before deriving a lifecycle; an unnormalized
// deleted status would fail closed as an unknown one.
export function isDeletedSubscriptionRecord(status: string): boolean {
  return status.trim().toLowerCase() === "deleted";
}

function subscriptionLifecycle(input: {
  cancelAtPeriodEnd: boolean;
  hasPendingUpgrade?: boolean;
  isPayg?: boolean;
  planName: string;
  status: string;
}): SubscriptionLifecycle {
  const status = input.status.trim().toLowerCase();
  // Expiry outranks a pending cancellation: once the platform starts the
  // deletion pipeline, "cancelling" would hide the countdown.
  if (DEBT_STATUSES.has(status)) {
    return "payment-due";
  }
  if (input.isPayg) {
    return "active";
  }
  // PAUSED is the healthy resting state of a no-trial Free workspace. The
  // platform creates those with CancelAtPeriodEnd already true, so paused
  // must resolve before the cancelling branch can misread it as a pending
  // deletion.
  if (status === "paused") {
    return input.hasPendingUpgrade ? "pending-upgrade" : "active";
  }
  // Payment actions fail closed for statuses the client does not understand.
  if (status !== "normal") {
    console.warn("[billing] unknown subscription status:", input.status);
    return "unavailable";
  }
  if (
    input.cancelAtPeriodEnd &&
    input.planName.trim().toLowerCase() !== "free"
  ) {
    return "cancelling";
  }
  if (input.hasPendingUpgrade) {
    return "pending-upgrade";
  }
  return "active";
}

// Keyed on the derived lifecycle, not the raw CancelAtPeriodEnd flag: the
// platform constructs every Free subscription with the flag already true, so
// the flag alone cannot tell a cancelled paid plan from a healthy Free trial
// (AIM-254 — the old costcenter carried the same Free exemption).
function periodEndVoice(input: {
  lifecycle: SubscriptionLifecycle;
  planName: string;
}): PeriodEndVoice {
  if (input.lifecycle === "cancelling" || input.lifecycle === "payment-due") {
    return "silent";
  }
  return input.planName.trim().toLowerCase() === "free" ? "expiry" : "renewal";
}

function subscriptionWarningStage(input: {
  lifecycle: SubscriptionLifecycle;
  status: string;
}): SubscriptionWarningStage | null {
  if (input.lifecycle === "payment-due") {
    return input.status.trim().toLowerCase() === "debt"
      ? "expired"
      : "deletion-imminent";
  }
  return input.lifecycle === "cancelling" ? "cancelling" : null;
}

function subscriptionWarningDeadline(input: {
  currentPeriodEndAt: string;
  expireAt: string | null;
  stage: SubscriptionWarningStage | null;
}): string | null {
  if (input.stage == null) {
    return null;
  }
  const basis = input.currentPeriodEndAt.trim() || input.expireAt?.trim() || "";
  const expiry = new Date(basis);
  if (Number.isNaN(expiry.getTime())) {
    return null;
  }
  // Before expiry the user's real deadline is the suspension date — the
  // period end itself. The derived deletion date only becomes the headline
  // once the workspace is already suspended.
  if (input.stage === "cancelling") {
    return expiry.toISOString();
  }
  return new Date(expiry.getTime() + RESOURCE_DELETION_GRACE_MS).toISOString();
}

function pendingTransactionFromOperator(
  transaction: z.infer<typeof transactionResponseSchema>["transaction"],
  operator: "downgraded" | "upgraded"
): BillingPlanSnapshot["pendingUpgrade"] {
  if (
    transaction?.Operator?.toLowerCase() !== operator ||
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

interface OptionalBillingResponse<T> {
  availability: BillingDataAvailability;
  value: T | null;
}

async function optionalBillingResponse<T>(
  request: Promise<unknown>,
  schema: z.ZodType<T>
): Promise<OptionalBillingResponse<T>> {
  try {
    return {
      availability: "available",
      value: schema.parse(await request),
    };
  } catch {
    return { availability: "unavailable", value: null };
  }
}

function availableWorkspaceData(
  subscriptionsAvailability: BillingDataAvailability,
  workspacesResponse: OptionalBillingResponse<
    z.infer<typeof workspacesResponseSchema>
  >
): {
  availability: BillingDataAvailability;
  workspaces: z.infer<typeof workspacesResponseSchema>["data"];
} {
  if (
    subscriptionsAvailability === "unavailable" ||
    workspacesResponse.availability === "unavailable"
  ) {
    return { availability: "unavailable", workspaces: [] };
  }
  return {
    availability: "available",
    workspaces: workspacesResponse.value?.data ?? [],
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

  const region = regionsResponseSchema.parse(
    await requestBillingJson("/api/billing/regions")
  ).current;

  const startTime = new Date(
    now.getTime() - DAYS_31_IN_MILLISECONDS
  ).toISOString();
  const endTime = now.toISOString();
  const workspaceRequest = {
    regionDomain: region.domain,
    workspace: credentials.workspace,
  };

  const [
    plansResponse,
    subscriptionResponse,
    transactionResponse,
    subscriptionsResponse,
    workspacesResponse,
    cardResponse,
  ] = await Promise.all([
    requestBillingJson("/api/billing/plans").then((payload) =>
      billingPlansResponseSchema.parse(payload)
    ),
    requestBillingJson("/api/billing/subscription", workspaceRequest).then(
      (payload) => subscriptionResponseSchema.parse(payload)
    ),
    optionalBillingResponse(
      requestBillingJson(
        "/api/billing/subscription/last-transaction",
        workspaceRequest
      ),
      transactionResponseSchema
    ),
    optionalBillingResponse(
      requestBillingJson("/api/billing/subscriptions"),
      subscriptionsResponseSchema
    ),
    optionalBillingResponse(
      requestBillingJson("/api/billing/workspaces", {
        endTime,
        startTime,
        type: 0,
      }),
      workspacesResponseSchema
    ),
    optionalBillingResponse(
      requestBillingJson("/api/billing/card", workspaceRequest),
      cardResponseSchema
    ),
  ]);

  const plans = plansResponse.plans
    .map(normalizeBillingPlan)
    .sort((left, right) => left.order - right.order);
  const rawSubscription = subscriptionResponse.subscription;
  // Present a deleted subscription as the no-subscription PAYG shape: stale
  // plan, period, and invoice facts must not leak into a workspace that can
  // simply subscribe again. The record's role survives for `canManage`.
  const subscription = isDeletedSubscriptionRecord(rawSubscription.Status)
    ? {
        ...rawSubscription,
        CancelAtPeriodEnd: false,
        CurrentPeriodEndAt: "",
        ExpireAt: null,
        InvoiceInfo: undefined,
        PlanName: "PAYG",
        Status: "",
        type: "PAYG" as const,
      }
    : rawSubscription;
  const transaction = transactionResponse.value?.transaction;
  const subscriptions = subscriptionsResponse.value?.subscriptions ?? [];
  const workspaceData = availableWorkspaceData(
    subscriptionsResponse.availability,
    workspacesResponse
  );
  const workspaces = workspaceData.workspaces;
  const paymentMethod = cardResponse.value?.payment_method ?? null;
  const pendingUpgrade = pendingTransactionFromOperator(
    transaction,
    "upgraded"
  );
  const pendingDowngrade = pendingTransactionFromOperator(
    transaction,
    "downgraded"
  );
  const currentPlan = plans.find((plan) => plan.name === subscription.PlanName);
  const lifecycle = subscriptionLifecycle({
    cancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
    hasPendingUpgrade: pendingUpgrade != null,
    isPayg: subscription.type === "PAYG",
    planName: subscription.PlanName,
    status: subscription.Status,
  });
  const warningStage = subscriptionWarningStage({
    lifecycle,
    status: subscription.Status,
  });
  const subscriptionByWorkspace = new Map(
    subscriptions.map((item) => [item.Workspace, item])
  );
  const planPriceByName = new Map(
    plans.map((plan) => [plan.name, plan.monthlyPriceMicroUnits])
  );

  return {
    availability: {
      card: cardResponse.availability,
      transaction: transactionResponse.availability,
      workspaces: workspaceData.availability,
    },
    card:
      paymentMethod == null
        ? null
        : {
            brand: paymentMethod.card.brand,
            expMonth: paymentMethod.card.exp_month ?? null,
            expYear: paymentMethod.card.exp_year ?? null,
            last4: paymentMethod.card.last4,
          },
    current: {
      // Subscription state and payment authority are orthogonal: whenever the
      // record names a role (including a normalized deleted one), only the
      // OWNER manages payments; a roleless PAYG record has no membership
      // facts, so managing stays open.
      canManage:
        subscription.role == null
          ? subscription.type === "PAYG"
          : subscription.role === "OWNER",
      cancelAtPeriodEnd: subscription.CancelAtPeriodEnd,
      currentPeriodEndAt: subscription.CurrentPeriodEndAt,
      invoiceId: subscription.InvoiceInfo?.ID ?? null,
      invoicePaymentUrl: subscription.InvoiceInfo?.PaymentUrl ?? null,
      isActiveFreeTrial: isActiveFreeTrialSubscription({
        planName: subscription.PlanName,
        status: subscription.Status,
        type: subscription.type ?? "",
      }),
      isPayg: subscription.type === "PAYG",
      lifecycle,
      payMethod: normalizedPayMethod(subscription.PayMethod),
      periodEndVoice: periodEndVoice({
        lifecycle,
        planName: subscription.PlanName,
      }),
      planName: subscription.PlanName,
      priceMicroUnits: currentPlan?.monthlyPriceMicroUnits ?? 0,
      regionDomain: subscription.RegionDomain || region.domain,
      resources:
        currentPlan?.resources.map(({ label, value }) => ({ label, value })) ??
        [],
      warningDeadlineAt: subscriptionWarningDeadline({
        currentPeriodEndAt: subscription.CurrentPeriodEndAt,
        expireAt: subscription.ExpireAt ?? null,
        stage: warningStage,
      }),
      warningStage,
      workspace: subscription.Workspace.trim() || credentials.workspace.trim(),
    },
    pendingDowngrade,
    pendingUpgrade,
    plans: plans.map((plan) => {
      const isCurrent = plan.name === subscription.PlanName;
      const planChangesAvailable = lifecycle !== "unavailable";
      // Mirrors the legacy costcenter decision tree: PAYG (no matching
      // current plan) treats every plan as a fresh subscription, the
      // catalog's transition lists label upgrades/downgrades, Enterprise
      // plans outside both lists route to sales, and anything else outside
      // both lists stays selectable as an upgrade — account-service is the
      // authority that rejects illegal moves.
      let changeKind: "contact" | "downgrade" | "subscribe" | "upgrade" | null =
        null;
      if (!isCurrent && planChangesAvailable) {
        if (currentPlan == null) {
          changeKind = "subscribe";
        } else if (currentPlan.upgradePlanNames?.includes(plan.name)) {
          changeKind = "upgrade";
        } else if (currentPlan.downgradePlanNames?.includes(plan.name)) {
          changeKind = "downgrade";
        } else if (plan.name.includes("Enterprise")) {
          changeKind = "contact";
        } else {
          changeKind = "upgrade";
        }
      }
      return {
        changeKind,
        description: plan.description,
        hasMonthlyPrice: plan.hasMonthlyPrice,
        id: plan.id,
        isCurrent,
        limits: plan.limits ?? {},
        name: plan.name,
        order: plan.order,
        originalPriceMicroUnits: plan.monthlyOriginalPriceMicroUnits,
        priceMicroUnits: plan.monthlyPriceMicroUnits,
        resources: plan.resources.map(({ label, type, value }) => ({
          label,
          type,
          value,
        })),
        tags: plan.tags,
      };
    }),
    workspaces: workspaces.map(([id, name]) => {
      const record = subscriptionByWorkspace.get(id);
      // A deleted record reports the PAYG billing mode, same as a workspace
      // with no subscription record at all.
      const item =
        record != null && isDeletedSubscriptionRecord(record.Status)
          ? undefined
          : record;
      const planName = item?.PlanName ?? "PAYG";
      return {
        id,
        isCurrent: id === credentials.workspace,
        lifecycle: subscriptionLifecycle({
          cancelAtPeriodEnd: item?.CancelAtPeriodEnd ?? false,
          isPayg: item == null,
          planName,
          status: item?.Status ?? "",
        }),
        name: name.trim() || id,
        planName,
        priceMicroUnits:
          item == null ? null : (planPriceByName.get(planName) ?? 0),
        renewalAt: item?.CurrentPeriodEndAt.trim() || null,
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

export interface PendingSubscriptionUpgrade {
  amountDueMicroUnits: number;
  createdAtSeconds: number;
  currency: string;
  discountMicroUnits?: number;
  hasDiscount?: boolean;
  invoiceId: string;
  originalAmountMicroUnits?: number;
  paymentId: string;
  paymentUrl: string;
  planName: string;
  promotionCode?: string;
  status: string;
  totalAmountMicroUnits?: number;
}

export type SubscriptionUpgradeQuoteResult =
  | { kind: "pending-upgrade"; pendingUpgrade: PendingSubscriptionUpgrade }
  | { kind: "quote"; quote: SubscriptionUpgradeQuote };

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

function pendingSubscriptionUpgradeFromPayload(
  payload: PendingSubscriptionUpgradePayload
): PendingSubscriptionUpgrade {
  return {
    amountDueMicroUnits: payload.amount_due,
    createdAtSeconds: payload.created_at,
    currency: payload.currency,
    ...(payload.discount_amount == null
      ? {}
      : { discountMicroUnits: payload.discount_amount }),
    ...(payload.has_discount == null
      ? {}
      : { hasDiscount: payload.has_discount }),
    invoiceId: payload.invoice_id,
    ...(payload.original_amount == null
      ? {}
      : { originalAmountMicroUnits: payload.original_amount }),
    paymentId: payload.payment_id,
    paymentUrl: payload.payment_url,
    planName: payload.plan_name,
    ...(payload.promotion_code == null
      ? {}
      : { promotionCode: payload.promotion_code }),
    status: payload.status,
    ...(payload.total_amount == null
      ? {}
      : { totalAmountMicroUnits: payload.total_amount }),
  };
}

export interface SubscriptionPlanCheckout {
  invoiceId: string | null;
  payId: string | null;
  redirectUrl: string | null;
  success: boolean;
}

export async function createSubscriptionPlanPayment(
  input: BillingWorkspaceOperationContext & {
    operator: "created" | "downgraded" | "renewed" | "upgraded";
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
    operator?: "created" | "upgraded";
    planName: string;
    promotionCode?: string;
  },
  dependencies: Pick<BillingPlanLoaderDependencies, "fetch"> = {}
): Promise<SubscriptionUpgradeQuoteResult> {
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
        operator: input.operator ?? "upgraded",
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
    if (error instanceof BillingRequestError && error.status === 409) {
      const pendingUpgrade = pendingSubscriptionUpgradeErrorSchema.safeParse(
        error.payload
      );
      if (pendingUpgrade.success) {
        return {
          kind: "pending-upgrade",
          pendingUpgrade: pendingSubscriptionUpgradeFromPayload(
            pendingUpgrade.data.pending_upgrade
          ),
        };
      }
      if (
        invalidPendingSubscriptionUpgradeErrorSchema.safeParse(error.payload)
          .success
      ) {
        throw error;
      }
    }
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
    kind: "quote",
    quote: {
      amountMicroUnits: quote.amount,
      discountMicroUnits: quote.has_discount
        ? Math.max(0, quote.original_amount - quote.amount)
        : 0,
      hasDiscount: quote.has_discount,
      originalAmountMicroUnits: quote.original_amount,
      promotionCode: quote.promotion_code,
    },
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
