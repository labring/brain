import { BinaryScale, Quantity, Scale } from "@workspace/shared";

export interface WorkspaceQuotaItem {
  limit: number;
  type: "cpu" | "memory" | "nodeport" | "storage";
  used: number;
}

export type AppSidebarUpgradeUsageRow = readonly [label: string, value: string];

const WORKSPACE_QUOTA_ROW_DEFINITIONS = [
  { label: "CPU", type: "cpu" },
  { label: "Memory", type: "memory" },
  { label: "Storage", type: "storage" },
  { label: "Ports", type: "nodeport" },
] as const;

function formatPortQuotaNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  if (!Number.isInteger(value)) {
    return "--";
  }
  return String(value);
}

function formatCpuQuotaNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  try {
    return Quantity.parse(`${value}m`).formatForDisplay({
      digits: 2,
      format: "DecimalSI",
      scale: Scale.None,
    });
  } catch {
    return "--";
  }
}

function formatBinaryQuotaNumberFromMi(value: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  try {
    return Quantity.parse(`${value}Mi`).formatForDisplay({
      digits: 2,
      format: "BinarySI",
      scale: BinaryScale.Gibi,
    });
  } catch {
    return "--";
  }
}

function formatQuotaValue(item: WorkspaceQuotaItem) {
  switch (item.type) {
    case "cpu":
      return `${formatCpuQuotaNumber(item.used)}C/${formatCpuQuotaNumber(
        item.limit
      )}C`;
    case "memory":
    case "storage":
      return `${formatBinaryQuotaNumberFromMi(
        item.used
      )}/${formatBinaryQuotaNumberFromMi(item.limit)}`;
    case "nodeport":
      return `${formatPortQuotaNumber(item.used)}/${formatPortQuotaNumber(
        item.limit
      )}`;
    default:
      return "--/--";
  }
}

export function formatWorkspaceQuotaRows(
  quota: readonly WorkspaceQuotaItem[]
): AppSidebarUpgradeUsageRow[] {
  return WORKSPACE_QUOTA_ROW_DEFINITIONS.map(({ label, type }) => {
    const item = quota.find((candidate) => candidate.type === type);
    if (item == null) {
      return [label, "--/--"] as const;
    }
    return [label, formatQuotaValue(item)] as const;
  });
}
