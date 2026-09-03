import { BinaryScale, Quantity, Scale } from "@workspace/shared";
import { z } from "zod";

import {
  ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES,
  type AccountServiceWorkspaceQuotaResponse,
  accountServiceWorkspaceQuotaResponseSchema,
  firstWorkspaceQuotaValue,
  isQuantityQuotaExhausted,
} from "./workspace-quota-payload";

const WORKSPACE_QUOTA_TYPES = [
  "cpu",
  "memory",
  "storage",
  "pod",
  "nodeport",
] as const;

export const workspaceQuotaItemSchema = z
  .object({
    exhausted: z.boolean().optional(),
    limit: z.number().finite().nonnegative(),
    type: z.enum(WORKSPACE_QUOTA_TYPES),
    used: z.number().finite().nonnegative(),
  })
  .strict();

export type WorkspaceQuotaItem = z.infer<typeof workspaceQuotaItemSchema>;

export const workspaceResourceQuotaSnapshotSchema = z
  .object({
    items: z.array(workspaceQuotaItemSchema).max(WORKSPACE_QUOTA_TYPES.length),
  })
  .strict();

export type WorkspaceResourceQuotaSnapshot = z.infer<
  typeof workspaceResourceQuotaSnapshotSchema
>;

export type WorkspaceResourceQuotaRow = readonly [
  label: "CPU" | "Memory" | "Storage" | "Pods" | "Ports",
  value: string,
];

const WORKSPACE_QUOTA_ROW_DEFINITIONS = [
  { label: "CPU", type: "cpu" },
  { label: "Memory", type: "memory" },
  { label: "Storage", type: "storage" },
  { label: "Pods", type: "pod" },
  { label: "Ports", type: "nodeport" },
] as const;

function formatPortQuotaNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : "--";
}

function formatCpuQuotaNumber(value: number): string {
  try {
    return Quantity.parse(`${String(value)}m`).formatForDisplay({
      digits: 2,
      format: "DecimalSI",
      scale: Scale.None,
    });
  } catch {
    return "--";
  }
}

function formatBinaryQuotaNumberFromMi(value: number): string {
  try {
    return Quantity.parse(`${String(value)}Mi`).formatForDisplay({
      digits: 2,
      format: "BinarySI",
      scale: BinaryScale.Gibi,
    });
  } catch {
    return "--";
  }
}

function formatQuotaValue(item: WorkspaceQuotaItem): string {
  switch (item.type) {
    case "cpu":
      return (
        formatCpuQuotaNumber(item.used) +
        "C/" +
        formatCpuQuotaNumber(item.limit) +
        "C"
      );
    case "memory":
    case "storage":
      return (
        formatBinaryQuotaNumberFromMi(item.used) +
        "/" +
        formatBinaryQuotaNumberFromMi(item.limit)
      );
    case "nodeport":
    case "pod":
      return (
        formatPortQuotaNumber(item.used) +
        "/" +
        formatPortQuotaNumber(item.limit)
      );
    default:
      return "--/--";
  }
}

export function parseWorkspaceQuotaItems(value: unknown): WorkspaceQuotaItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const parsed = workspaceQuotaItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function normalizedQuotaNumber(
  quantity: Quantity,
  scale: "mebi" | "milli" | "unit"
): number | null {
  try {
    let normalized: bigint;
    if (scale === "milli") {
      normalized = quantity.milliValue();
    } else if (scale === "mebi") {
      normalized = quantity.scaledBinaryValue(BinaryScale.Mebi);
    } else {
      normalized = quantity.value();
    }
    const number = Number(normalized);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  } catch {
    return null;
  }
}

/**
 * Converts account-service's Kubernetes quantity payload into the compact
 * snapshot shared by the sidebar, notifications, and assistant context.
 */
export function workspaceQuotaSnapshotFromPayload(
  payload: unknown
): WorkspaceResourceQuotaSnapshot | undefined {
  const parsed = accountServiceWorkspaceQuotaResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  return workspaceQuotaSnapshotFromResponse(parsed.data);
}

export function workspaceQuotaSnapshotFromResponse(
  response: AccountServiceWorkspaceQuotaResponse
): WorkspaceResourceQuotaSnapshot | undefined {
  const { hard, used } = response.quota;
  const items = ACCOUNT_SERVICE_WORKSPACE_QUOTA_RESOURCES.flatMap(
    ({ keys, snapshotScale, type }) => {
      if (snapshotScale == null) {
        return [];
      }
      const limitValue = firstWorkspaceQuotaValue(hard, keys);
      if (limitValue === undefined) {
        return [];
      }
      try {
        const limitQuantity = Quantity.fromJSON(limitValue);
        const usedValue = firstWorkspaceQuotaValue(used, keys);
        const consumedQuantity = Quantity.fromJSON(usedValue ?? "0");
        const limit = normalizedQuotaNumber(limitQuantity, snapshotScale);
        const consumed = normalizedQuotaNumber(consumedQuantity, snapshotScale);
        return limit == null || consumed == null
          ? []
          : [
              {
                exhausted: isQuantityQuotaExhausted(
                  consumedQuantity,
                  limitQuantity
                ),
                limit,
                type,
                used: consumed,
              },
            ];
      } catch {
        return [];
      }
    }
  );
  return items.length === 0 ? undefined : { items };
}

export function formatWorkspaceQuotaRows(
  quota: readonly WorkspaceQuotaItem[],
  options: { includeMissing?: boolean } = {}
): WorkspaceResourceQuotaRow[] {
  const includeMissing = options.includeMissing ?? true;
  return WORKSPACE_QUOTA_ROW_DEFINITIONS.flatMap(({ label, type }) => {
    const item = quota.find((candidate) => candidate.type === type);
    if (item == null) {
      return includeMissing ? ([[label, "--/--"]] as const) : [];
    }
    return [[label, formatQuotaValue(item)] as const];
  });
}
