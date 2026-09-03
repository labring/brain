import { SNAPSHOT_WORKSPACE_QUOTA_RESOURCES } from "@/features/billing/workspace-quota-payload";
import {
  formatWorkspaceQuotaItemValue,
  type WorkspaceQuotaItem,
} from "@/features/billing/workspace-resource-quota";

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
  return SNAPSHOT_WORKSPACE_QUOTA_RESOURCES.map(({ label, type }) => {
    const item = quota.find((candidate) => candidate.type === type);
    if (item == null) {
      return { label, percent: null, value: "--/--" };
    }
    return {
      label,
      percent: quotaPercent(item),
      value: formatWorkspaceQuotaItemValue(item),
    };
  });
}
