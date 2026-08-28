import { z } from "zod";

import {
  firstFullQuotaRow,
  type QuotaFullnessRow,
  workspaceQuotaRowsFromPayload,
} from "@/features/billing/billing-usage-data";

/**
 * A workspace's billing standing as the platform judges it, read from the
 * raw account-service payloads (design spec §3 rows E1–E3): whether the
 * account is in debt, whether a deployable quota is full, and what paid AI
 * usage settles against. Pure — the server-side reader hands it the four
 * upstream bodies (or null for a read that did not answer), and the same
 * judgment serves the paid-chat gate and the deploy failure reverse-check,
 * so "the pre-deploy wall" and "why did the deployment die" can never
 * disagree.
 */

/** What a workspace's paid AI usage settles against (CONTEXT.md: AI Credits vs Account Balance). */
export type WorkspaceAiPaidSource = "ai-credits" | "balance";

export interface WorkspaceAiCredits {
  totalMicroUnits: number;
  usedMicroUnits: number;
}

export interface WorkspaceBillingStanding {
  /** Available amount ≤ 0 (the platform's debt formula); null while unknown. */
  accountDebt: boolean | null;
  /** The subscription's AI Credits; null on PAYG or while unknown. */
  aiCredits: WorkspaceAiCredits | null;
  /** Balance − DeductionBalance + usable credits; null while either read is missing. */
  availableBalanceMicroUnits: number | null;
  /** The first deployable quota at or past 100%; null when none — or when unread (see quotaKnown). */
  fullQuota: QuotaFullnessRow | null;
  /** What paid AI usage spends; null while the subscription type is unknown. */
  paidSource: WorkspaceAiPaidSource | null;
  /** Whether the quota read answered, so a null fullQuota is a fact. */
  quotaKnown: boolean;
}

export const UNKNOWN_BILLING_STANDING: WorkspaceBillingStanding = {
  accountDebt: null,
  aiCredits: null,
  availableBalanceMicroUnits: null,
  fullQuota: null,
  paidSource: null,
  quotaKnown: false,
};

export interface WorkspaceBillingPayloads {
  /** `/account/v1alpha1/account` body, or null when the read failed. */
  account: unknown;
  /** `/payment/v1alpha1/credits/info` body, or null. */
  credits: unknown;
  /** `/account/v1alpha1/workspace/get-resource-quota` body, or null. */
  quota: unknown;
  /** `/account/v1alpha1/workspace-subscription/info` body, or null. */
  subscription: unknown;
}

const accountSchema = z.object({
  account: z.object({ Balance: z.number(), DeductionBalance: z.number() }),
});

const creditsSchema = z.object({
  credits: z.object({
    credits: z.number().default(0),
    deductionCredits: z.number().default(0),
  }),
});

const subscriptionSchema = z.object({
  subscription: z.object({
    Status: z.string().optional(),
    type: z.string().optional(),
  }),
});

const quantityValueSchema = z.union([z.string(), z.number()]);
const aiQuotaSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

function microUnits(value: string | number | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cashMicroUnits(account: unknown): number | null {
  const parsed = accountSchema.safeParse(account);
  return parsed.success
    ? parsed.data.account.Balance - parsed.data.account.DeductionBalance
    : null;
}

function usableCreditMicroUnits(credits: unknown): number | null {
  const parsed = creditsSchema.safeParse(credits);
  return parsed.success
    ? Math.max(
        0,
        parsed.data.credits.credits - parsed.data.credits.deductionCredits
      )
    : null;
}

function subscriptionFacts(subscription: unknown): {
  inDebt: boolean;
  paidSource: WorkspaceAiPaidSource | null;
} {
  const parsed = subscriptionSchema.safeParse(subscription);
  if (!parsed.success) {
    return { inDebt: false, paidSource: null };
  }
  const type = parsed.data.subscription.type?.trim().toLowerCase() ?? "";
  const status = parsed.data.subscription.Status?.trim().toUpperCase() ?? "";
  if (type === "") {
    return { inDebt: false, paidSource: null };
  }
  // An upstream record in DELETED status is not a Workspace Subscription:
  // the workspace is Pay-As-You-Go (CONTEXT.md, Workspace Subscription).
  const payg = type !== "subscription" || status === "DELETED";
  return {
    // A PAYG workspace the platform reports on the debt ladder is Account
    // Debt by definition — no timestamps, no subscription (CONTEXT.md).
    inDebt: payg && status.startsWith("DEBT"),
    paidSource: payg ? "balance" : "ai-credits",
  };
}

function aiCreditsFromQuota(quota: unknown): WorkspaceAiCredits | null {
  const parsed = aiQuotaSchema.safeParse(quota);
  if (!parsed.success) {
    return null;
  }
  const total = microUnits(parsed.data.quota.hard.ai_quota);
  if (total == null) {
    return null;
  }
  return {
    totalMicroUnits: total,
    usedMicroUnits: microUnits(parsed.data.quota.used.ai_quota) ?? 0,
  };
}

export function judgeWorkspaceBillingStanding(
  payloads: WorkspaceBillingPayloads
): WorkspaceBillingStanding {
  const cash = cashMicroUnits(payloads.account);
  const credits = usableCreditMicroUnits(payloads.credits);
  const available = cash == null || credits == null ? null : cash + credits;
  const facts = subscriptionFacts(payloads.subscription);
  let accountDebt: boolean | null = null;
  if (facts.inDebt) {
    accountDebt = true;
  } else if (available != null) {
    accountDebt = available <= 0;
  }
  const rows = workspaceQuotaRowsFromPayload(payloads.quota);
  const fullRow = rows == null ? null : firstFullQuotaRow(rows);
  return {
    accountDebt,
    aiCredits:
      facts.paidSource === "ai-credits"
        ? aiCreditsFromQuota(payloads.quota)
        : null,
    availableBalanceMicroUnits: available,
    fullQuota:
      fullRow == null
        ? null
        : {
            label: fullRow.label,
            percentUsed: fullRow.percentUsed,
            type: fullRow.type,
          },
    paidSource: facts.paidSource,
    quotaKnown: rows != null,
  };
}

/**
 * Whether the platform has suspended THIS workspace for Account Debt.
 * Account Debt is an account-level state — the Status Hint voices it in
 * every workspace — but the platform's debt pipeline stops only
 * Pay-As-You-Go workspaces; a subscribed workspace's resources ride its plan
 * and its AI usage its AI Credits (CONTEXT.md, Account Debt; design spec
 * row E1). So only a workspace paying from the balance can be walled or
 * have its failure reclassified on debt. Null while either fact is unknown:
 * every seam fails open (ADR-0068).
 */
export function debtSuspendsWorkspace(
  standing: Pick<WorkspaceBillingStanding, "accountDebt" | "paidSource">
): boolean | null {
  if (standing.paidSource == null) {
    return null;
  }
  if (standing.paidSource !== "balance") {
    return false;
  }
  return standing.accountDebt;
}
