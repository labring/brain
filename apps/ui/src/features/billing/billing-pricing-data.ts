import { z } from "zod";

import {
  type BillingCredentials,
  type BillingFetch,
  createBillingJsonRequester,
} from "./billing-data-client";
import {
  billingPlansResponseSchema,
  type NormalizedBillingPlan,
  normalizeBillingPlan,
} from "./billing-plan-catalog";

export type BillingPriceType =
  | "cpu"
  | "gpu"
  | "memory"
  | "network"
  | "nodeport"
  | "storage"
  | "traffic";

export interface BillingMeteredPrice {
  billingBasis: "duration" | "quantity";
  hourlyPriceMicroUnits: number;
  label: string;
  sourceName: string;
  type: BillingPriceType;
  unit: string;
}

export type BillingPricingPlan = NormalizedBillingPlan;

export interface BillingPricingSnapshot {
  isPayg: boolean;
  plans: BillingPricingPlan[];
  prices: BillingMeteredPrice[];
}

interface BillingPricingDependencies {
  fetch?: BillingFetch;
}

const propertiesResponseSchema = z.object({
  data: z.object({
    properties: z.array(
      z.object({
        alias: z.string().optional(),
        name: z.string().trim().min(1),
        unit: z.string().default(""),
        unit_price: z.number().optional(),
      })
    ),
  }),
});
const regionsResponseSchema = z.object({
  regions: z.array(z.object({ domain: z.string().trim().min(1) })),
});
const subscriptionResponseSchema = z.object({
  subscription: z.object({
    type: z.enum(["PAYG", "SUBSCRIPTION"]).optional(),
  }),
});

interface PropertyMetadata {
  billingBasis: BillingMeteredPrice["billingBasis"];
  label: string;
  order: number;
  scale: number;
  type: BillingPriceType;
  unit: string;
}

const PROPERTY_METADATA: Readonly<Record<string, PropertyMetadata>> = {
  cpu: {
    billingBasis: "duration",
    label: "CPU",
    order: 0,
    scale: 1000,
    type: "cpu",
    unit: "vCPU",
  },
  memory: {
    billingBasis: "duration",
    label: "Memory",
    order: 1,
    scale: 1024,
    type: "memory",
    unit: "GiB",
  },
  storage: {
    billingBasis: "duration",
    label: "Storage",
    order: 2,
    scale: 1024,
    type: "storage",
    unit: "GiB",
  },
  network: {
    billingBasis: "quantity",
    label: "Network traffic",
    order: 4,
    scale: 1,
    type: "network",
    unit: "MiB",
  },
  "services.nodeports": {
    billingBasis: "duration",
    label: "Public ports",
    order: 5,
    scale: 1,
    type: "nodeport",
    unit: "port",
  },
  traffic: {
    billingBasis: "quantity",
    label: "Traffic",
    order: 6,
    scale: 1024 * 1024 * 1024,
    type: "traffic",
    unit: "GiB",
  },
};

function normalizePrices(
  properties: z.infer<typeof propertiesResponseSchema>["data"]["properties"]
): BillingMeteredPrice[] {
  return properties
    .flatMap((property) => {
      if (property.name.startsWith("gpu-")) {
        return [
          {
            billingBasis: "duration" as const,
            hourlyPriceMicroUnits: property.unit_price ?? 0,
            label: property.alias?.trim() || property.name,
            order: 3,
            sourceName: property.name,
            type: "gpu" as const,
            unit: "GPU",
          },
        ];
      }
      const metadata = PROPERTY_METADATA[property.name];
      if (metadata == null) {
        return [];
      }
      return [
        {
          billingBasis: metadata.billingBasis,
          hourlyPriceMicroUnits: (property.unit_price ?? 0) * metadata.scale,
          label: metadata.label,
          order: metadata.order,
          sourceName: property.name,
          type: metadata.type,
          unit: property.unit.trim() || metadata.unit,
        },
      ];
    })
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...price }) => price);
}

export async function loadBillingPricing(
  input: BillingCredentials & { workspace: string },
  dependencies: BillingPricingDependencies = {}
): Promise<BillingPricingSnapshot> {
  const fetch = dependencies.fetch ?? globalThis.fetch;
  const credentials = {
    appToken: input.appToken,
    kubeconfig: input.kubeconfig,
  };
  const requestBillingJson = createBillingJsonRequester({
    credentials,
    fallbackErrorMessage: "Could not load pricing.",
    fetch,
  });
  const plansPromise = requestBillingJson("/api/billing/plans");
  const propertiesPromise = requestBillingJson("/api/billing/properties");
  const regionsPayload = await requestBillingJson("/api/billing/regions");
  const region = regionsResponseSchema.parse(regionsPayload).regions[0];
  if (region == null) {
    throw new Error("Billing region is unavailable.");
  }
  const subscriptionPromise = requestBillingJson("/api/billing/subscription", {
    regionDomain: region.domain,
    workspace: input.workspace,
  });

  const [plansPayload, propertiesPayload, subscriptionPayload] =
    await Promise.all([plansPromise, propertiesPromise, subscriptionPromise]);
  const plans = billingPlansResponseSchema
    .parse(plansPayload)
    .plans.flatMap((plan) => {
      return plan.Prices.length === 0 ? [] : [normalizeBillingPlan(plan)];
    })
    .sort((left, right) => left.order - right.order);
  const properties = propertiesResponseSchema.parse(propertiesPayload);
  const subscription = subscriptionResponseSchema.parse(subscriptionPayload);

  return {
    isPayg: subscription.subscription.type === "PAYG",
    plans,
    prices: normalizePrices(properties.data.properties),
  };
}
