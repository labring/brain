import { z } from "zod";

/** Platform micro-units per displayed AI Credit (1 credit = 0.01 currency units). */
export const MICRO_UNITS_PER_AI_CREDIT = 10_000;

const quantityValueSchema = z.union([z.string(), z.number()]);

export const aiQuotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

export interface AiQuotaSnapshot {
  hasAllowance: boolean;
  totalMicroUnits: number;
  usedMicroUnits: number;
}

export type WorkspaceAiQuota =
  | {
      status: "available";
      totalMicroUnits: number;
      usedMicroUnits: number;
    }
  | { status: "not_applicable" }
  | { status: "unavailable" };

function microUnitsFromQuota(value: string | number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function parseAiQuotaPayload(payload: unknown): AiQuotaSnapshot {
  const parsed = aiQuotaResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("AI quota response is invalid.");
  }

  return {
    hasAllowance: Object.hasOwn(parsed.data.quota.hard, "ai_quota"),
    totalMicroUnits: microUnitsFromQuota(parsed.data.quota.hard.ai_quota),
    usedMicroUnits: microUnitsFromQuota(parsed.data.quota.used.ai_quota),
  };
}

export function formatAiCredits(microUnits: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(microUnits / MICRO_UNITS_PER_AI_CREDIT);
}
