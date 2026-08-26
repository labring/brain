import { BinaryScale, Quantity, Scale } from "@workspace/shared";
import type { WorkspaceQuotaItem } from "@/features/billing/workspace-resource-quota";

export type { WorkspaceQuotaItem } from "@/features/billing/workspace-resource-quota";

export interface AppSidebarQuotaRow {
  label: string;
  /** Used share of the limit in percent (0–100), or null when unknowable. */
  percent: number | null;
  value: string;
}

/** Quota rows at or above this share render in the warning color. */
export const QUOTA_WARNING_PERCENT = 80;

/** Quota rows at or above this share render in the danger color. */
export const QUOTA_DANGER_PERCENT = 100;

export type QuotaUsageTone = "danger" | "warn";

/**
 * The two-tier attention rule every popover usage row shares: warning from
 * QUOTA_WARNING_PERCENT, danger at QUOTA_DANGER_PERCENT — where usage stops
 * being "almost full" and becomes a hard stop (nothing new starts, the
 * assistant blocks).
 */
export function quotaUsageTone(percent: number | null): QuotaUsageTone | null {
  if (percent == null) {
    return null;
  }
  if (percent >= QUOTA_DANGER_PERCENT) {
    return "danger";
  }
  if (percent >= QUOTA_WARNING_PERCENT) {
    return "warn";
  }
  return null;
}

const WORKSPACE_QUOTA_ROW_DEFINITIONS = [
  { label: "CPU", type: "cpu" },
  { label: "Memory", type: "memory" },
  { label: "Storage", type: "storage" },
  { label: "Pods", type: "pod" },
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
    case "pod":
      return `${formatPortQuotaNumber(item.used)}/${formatPortQuotaNumber(
        item.limit
      )}`;
    default:
      return "--/--";
  }
}

function quotaPercent(item: WorkspaceQuotaItem): number | null {
  if (
    !(Number.isFinite(item.used) && Number.isFinite(item.limit)) ||
    item.limit <= 0
  ) {
    return null;
  }
  return Math.min(100, Math.max(0, (item.used / item.limit) * 100));
}

export function formatWorkspaceQuotaRows(
  quota: readonly WorkspaceQuotaItem[]
): AppSidebarQuotaRow[] {
  return WORKSPACE_QUOTA_ROW_DEFINITIONS.map(({ label, type }) => {
    const item = quota.find((candidate) => candidate.type === type);
    if (item == null) {
      return { label, percent: null, value: "--/--" };
    }
    return {
      label,
      percent: quotaPercent(item),
      value: formatQuotaValue(item),
    };
  });
}
