import type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

function createdAtSortKey(iso: string): number {
  const t = iso.trim();
  if (t === "") {
    return Number.NEGATIVE_INFINITY;
  }
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/**
 * Newest `createdAt` first. Rows with empty `createdAt` sort to the bottom;
 * tie-breaker: `versionHash` (stable).
 */
export function sortSnapshotRowsByCreatedAtDesc(
  rows: ContainerHistorySnapshotRow[]
): ContainerHistorySnapshotRow[] {
  return [...rows].sort((a, b) => {
    const diff = createdAtSortKey(b.createdAt) - createdAtSortKey(a.createdAt);
    if (diff !== 0) {
      return diff;
    }
    return a.versionHash.localeCompare(b.versionHash);
  });
}
