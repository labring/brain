import { Quantity } from "@workspace/shared";
import { z } from "zod";

const quantityValueSchema = z.union([z.string(), z.number()]);

export const accountServiceWorkspaceQuotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

export type AccountServiceWorkspaceQuotaResponse = z.infer<
  typeof accountServiceWorkspaceQuotaResponseSchema
>;

/**
 * The account-service resource keys in their product display order. This is
 * the single alias table for the Usage view, Status Hint, sidebar, inbox, and
 * assistant quota context. GPU and traffic have no compact snapshot scale
 * because they are not Deployable Quota resources.
 */
export const ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES = [
  {
    keys: ["limits.cpu"],
    label: "CPU",
    snapshotScale: "milli",
    type: "cpu",
  },
  {
    keys: ["limits.memory"],
    label: "Memory",
    snapshotScale: "mebi",
    type: "memory",
  },
  {
    keys: ["requests.storage"],
    label: "Storage",
    snapshotScale: "mebi",
    type: "storage",
  },
  {
    keys: ["pods", "count/pods"],
    label: "Pods",
    snapshotScale: "unit",
    type: "pod",
  },
  {
    keys: ["services.nodeports"],
    label: "Ports",
    snapshotScale: "unit",
    type: "nodeport",
  },
  {
    keys: ["traffic"],
    label: "Traffic",
    snapshotScale: null,
    type: "traffic",
  },
  {
    keys: ["limits.nvidia.com/gpu", "requests.nvidia.com/gpu"],
    label: "GPU",
    snapshotScale: null,
    type: "gpu",
  },
] as const;

export type AccountServiceWorkspaceQuotaType =
  (typeof ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES)[number]["type"];

export function firstWorkspaceQuotaValue(
  values: Record<string, string | number>,
  keys: readonly string[]
): string | number | undefined {
  for (const key of keys) {
    if (values[key] !== undefined) {
      return values[key];
    }
  }
  return undefined;
}

/** A zero or unknown ceiling is never exhausted. */
export function isQuantityQuotaExhausted(
  used: Quantity,
  limit: Quantity
): boolean {
  return !limit.equals(Quantity.ZERO) && used.cmp(limit) >= 0;
}
