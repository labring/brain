import { BinaryScale, Quantity, Scale } from "@workspace/shared";
import { z } from "zod";

const WORKSPACE_QUOTA_TYPES = [
  "cpu",
  "memory",
  "storage",
  "pod",
  "nodeport",
] as const;

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
