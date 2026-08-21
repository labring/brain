import { Quantity } from "@workspace/shared";
import { z } from "zod";

import { formatAiCredits } from "./billing-ai-credits";

const resourceValueSchema = z.union([z.string(), z.number()]);

export const billingPlanSchema = z.object({
  AIQuota: z.number().default(0),
  Description: z.string().default(""),
  DowngradePlanList: z.array(z.string()).nullable().optional(),
  ID: z.string().min(1),
  MaxResources: z.union([
    z.string(),
    z.record(z.string(), resourceValueSchema),
  ]),
  MaxSeats: z.number().default(0),
  Name: z.string().min(1),
  Order: z.number().default(0),
  Prices: z
    .array(
      z.object({
        BillingCycle: z.string(),
        OriginalPrice: z.number().default(0),
        Price: z.number(),
      })
    )
    .default([]),
  Tags: z.array(z.string()).default([]),
  Traffic: z.number().default(0),
  UpgradePlanList: z.array(z.string()).nullable().optional(),
});

export const billingPlansResponseSchema = z.object({
  plans: z.array(billingPlanSchema),
});

export type BillingPlanResourceType =
  | "ai"
  | "cpu"
  | "gpu"
  | "memory"
  | "nodeport"
  | "other"
  | "seats"
  | "storage"
  | "traffic";

export interface NormalizedBillingPlan {
  description: string;
  downgradePlanNames?: string[];
  hasMonthlyPrice: boolean;
  id: string;
  limits?: Partial<Record<BillingPlanResourceType, string>>;
  monthlyOriginalPriceMicroUnits: number;
  monthlyPriceMicroUnits: number;
  name: string;
  order: number;
  primaryPriceMicroUnits: number;
  resources: Array<{
    label: string;
    type: BillingPlanResourceType;
    value: string;
  }>;
  tags: string[];
  upgradePlanNames?: string[];
}

const RESOURCE_METADATA: Record<
  string,
  { label: string; order: number; type: BillingPlanResourceType }
> = {
  cpu: { label: "CPU", order: 0, type: "cpu" },
  memory: { label: "Memory", order: 1, type: "memory" },
  storage: { label: "Storage", order: 2, type: "storage" },
  nodeports: { label: "Public ports", order: 4, type: "nodeport" },
};

function parseMaxResources(
  input: z.infer<typeof billingPlanSchema>["MaxResources"]
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

function resourceMetadata(key: string): {
  label: string;
  order: number;
  type: BillingPlanResourceType;
} {
  const normalized = key.toLowerCase();
  if (normalized.includes("gpu")) {
    return { label: "GPU", order: 3, type: "gpu" };
  }
  return (
    RESOURCE_METADATA[normalized] ?? {
      label: key,
      order: 7,
      type: "other",
    }
  );
}

function displayPlanResource(value: string | number): string {
  try {
    return Quantity.fromJSON(value).formatForDisplay({ format: "BinarySI" });
  } catch {
    return String(value);
  }
}

export function normalizeBillingPlan(
  plan: z.infer<typeof billingPlanSchema>
): NormalizedBillingPlan {
  const resources: NormalizedBillingPlan["resources"] = Object.entries(
    parseMaxResources(plan.MaxResources)
  )
    .map(([key, value]) => ({
      ...resourceMetadata(key),
      value: displayPlanResource(value),
    }))
    .sort((left, right) => left.order - right.order)
    .map(({ label, type, value }) => ({ label, type, value }));

  const trafficBytes = BigInt(Math.round(plan.Traffic * 1024 * 1024));
  resources.push({
    label: "Traffic",
    type: "traffic",
    value: Quantity.newQuantity(trafficBytes, "BinarySI").formatForDisplay({
      format: "BinarySI",
    }),
  });
  if (plan.AIQuota > 0) {
    resources.push({
      label: "AI Credits",
      type: "ai",
      value: formatAiCredits(plan.AIQuota),
    });
  }
  if (plan.MaxSeats > 1) {
    resources.push({
      label: "Seats",
      type: "seats",
      value: String(plan.MaxSeats),
    });
  }

  const limits = Object.fromEntries(
    resources
      .filter(({ type }) =>
        ["cpu", "gpu", "memory", "nodeport", "storage", "traffic"].includes(
          type
        )
      )
      .map(({ type, value }) => [type, value])
  ) as Partial<Record<BillingPlanResourceType, string>>;
  const monthlyPrice = plan.Prices.find((price) => price.BillingCycle === "1m");

  return {
    description: plan.Description,
    downgradePlanNames: plan.DowngradePlanList ?? undefined,
    hasMonthlyPrice: monthlyPrice != null,
    id: plan.ID,
    limits,
    monthlyOriginalPriceMicroUnits: monthlyPrice?.OriginalPrice ?? 0,
    monthlyPriceMicroUnits: monthlyPrice?.Price ?? 0,
    name: plan.Name,
    order: plan.Order,
    primaryPriceMicroUnits: plan.Prices[0]?.Price ?? 0,
    resources,
    tags: plan.Tags,
    upgradePlanNames: plan.UpgradePlanList ?? undefined,
  };
}
