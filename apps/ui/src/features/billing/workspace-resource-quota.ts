import { BinaryScale, Quantity, Scale } from "@workspace/shared";
import { z } from "zod";

const WORKSPACE_QUOTA_TYPES = [
  "cpu",
  "memory",
  "storage",
  "pod",
  "nodeport",
] as const;

const quantityValueSchema = z.union([z.string(), z.number()]);
const accountServiceQuotaResponseSchema = z.object({
  quota: z.object({
    hard: z.record(z.string(), quantityValueSchema).optional().default({}),
    used: z.record(z.string(), quantityValueSchema).optional().default({}),
  }),
});

export const workspaceQuotaItemSchema = z
  .object({
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

const ACCOUNT_SERVICE_QUOTA_DEFINITIONS = [
  { keys: ["limits.cpu"], scale: "milli", type: "cpu" },
  { keys: ["limits.memory"], scale: "mebi", type: "memory" },
  { keys: ["requests.storage"], scale: "mebi", type: "storage" },
  { keys: ["pods", "count/pods"], scale: "unit", type: "pod" },
  { keys: ["services.nodeports"], scale: "unit", type: "nodeport" },
] as const;

function firstQuantityValue(
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

function normalizedQuotaNumber(
  value: string | number,
  scale: "mebi" | "milli" | "unit"
): number | null {
  try {
    const quantity = Quantity.fromJSON(value);
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
  const parsed = accountServiceQuotaResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { hard, used } = parsed.data.quota;
  const items = ACCOUNT_SERVICE_QUOTA_DEFINITIONS.flatMap(
    ({ keys, scale, type }) => {
      const limitValue = firstQuantityValue(hard, keys);
      if (limitValue === undefined) {
        return [];
      }
      const limit = normalizedQuotaNumber(limitValue, scale);
      const usedValue = firstQuantityValue(used, keys);
      const consumed =
        usedValue === undefined ? 0 : normalizedQuotaNumber(usedValue, scale);
      return limit == null || consumed == null
        ? []
        : [{ limit, type, used: consumed }];
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
