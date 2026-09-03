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

type AccountServiceWorkspaceQuotaResource =
  (typeof ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES)[number];

export type SnapshotWorkspaceQuotaResource = Extract<
  AccountServiceWorkspaceQuotaResource,
  { snapshotScale: "mebi" | "milli" | "unit" }
>;

export const SNAPSHOT_WORKSPACE_QUOTA_RESOURCES =
  ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES.filter(
    (resource): resource is SnapshotWorkspaceQuotaResource =>
      resource.snapshotScale !== null
  );

export interface WorkspaceQuotaValues {
  limit: string | number | undefined;
  used: string | number | undefined;
}

/** Selects one account-service alias and reads both sides through that key. */
export function workspaceQuotaValuesForAliases(
  hard: Record<string, string | number>,
  used: Record<string, string | number>,
  keys: readonly string[]
): WorkspaceQuotaValues {
  let hardOnlyKey: string | undefined;
  let usedOnlyKey: string | undefined;
  for (const key of keys) {
    const hasHard = hard[key] !== undefined;
    const hasUsed = used[key] !== undefined;
    if (hasHard && hasUsed) {
      return { limit: hard[key], used: used[key] };
    }
    if (hasHard && hardOnlyKey === undefined) {
      hardOnlyKey = key;
    }
    if (hasUsed && usedOnlyKey === undefined) {
      usedOnlyKey = key;
    }
  }
  const key = hardOnlyKey ?? usedOnlyKey;
  return key === undefined
    ? { limit: undefined, used: undefined }
    : { limit: hard[key], used: used[key] };
}

/** A zero or unknown ceiling is never exhausted. */
export function isQuantityQuotaExhausted(
  used: Quantity,
  limit: Quantity
): boolean {
  return !limit.equals(Quantity.ZERO) && used.cmp(limit) >= 0;
}
