import { z } from "zod";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";

/** Platform micro-units per displayed AI Credit (1 credit = 0.01 currency units). */
export const MICRO_UNITS_PER_AI_CREDIT = 10_000;

const CREDITS_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

const quantityValueSchema = z.union([z.string(), z.number()]);
const quotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

export interface AiCredits {
  totalMicroUnits: number;
  usedMicroUnits: number;
}

function microUnitsFromQuota(value: string | number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatAiCredits(microUnits: number): string {
  return CREDITS_FORMATTER.format(microUnits / MICRO_UNITS_PER_AI_CREDIT);
}

export function aiCreditsPercentUsed(
  usedMicroUnits: number,
  totalMicroUnits: number
): number {
  if (totalMicroUnits <= 0) {
    return 0;
  }
  const percent = (usedMicroUnits / totalMicroUnits) * 100;
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export async function loadAiCredits(
  credentials: BillingCredentials & { workspace: string },
  fetch: BillingFetch = globalThis.fetch
): Promise<AiCredits> {
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load AI Credits.",
    fetch,
  });
  const payload = await requestBillingJson("/api/billing/workspace-quota", {
    workspace: credentials.workspace,
  });
  const parsed = quotaResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("AI Credits response is invalid.");
  }
  return {
    totalMicroUnits: microUnitsFromQuota(parsed.data.quota.hard.ai_quota),
    usedMicroUnits: microUnitsFromQuota(parsed.data.quota.used.ai_quota),
  };
}
