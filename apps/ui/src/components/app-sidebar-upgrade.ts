export interface WorkspaceQuotaItem {
  limit: number;
  type: "cpu" | "memory" | "nodeport" | "storage";
  used: number;
}

export type AppSidebarUpgradeUsageRow = readonly [label: string, value: string];

const WORKSPACE_QUOTA_ROW_DEFINITIONS = [
  { label: "CPU", type: "cpu", unit: "C", valueScale: 1000 },
  { label: "Memory", type: "memory", unit: "GB", valueScale: 1024 },
  { label: "Storage", type: "storage", unit: "GB", valueScale: 1024 },
  { label: "Ports", type: "nodeport", unit: "", valueScale: 1 },
] as const;
const TRAILING_DECIMAL_ZEROES_RE = /\.?0+$/;

function formatScaledQuotaNumber(value: number, scale: number) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const scaled = value / scale;
  if (!Number.isFinite(scaled)) {
    return "--";
  }
  return Number.isInteger(scaled)
    ? String(scaled)
    : scaled.toFixed(2).replace(TRAILING_DECIMAL_ZEROES_RE, "");
}

function formatQuotaValue({
  limit,
  unit,
  used,
  valueScale,
}: {
  limit: number;
  unit: string;
  used: number;
  valueScale: number;
}) {
  const value = `${formatScaledQuotaNumber(
    used,
    valueScale
  )}/${formatScaledQuotaNumber(limit, valueScale)}`;
  return `${value}${unit}`;
}

export function formatWorkspaceQuotaRows(
  quota: readonly WorkspaceQuotaItem[]
): AppSidebarUpgradeUsageRow[] {
  return WORKSPACE_QUOTA_ROW_DEFINITIONS.map(
    ({ label, type, unit, valueScale }) => {
      const item = quota.find((candidate) => candidate.type === type);
      if (item == null) {
        return [label, "--/--"] as const;
      }
      return [
        label,
        formatQuotaValue({
          limit: item.limit,
          unit,
          used: item.used,
          valueScale,
        }),
      ] as const;
    }
  );
}
