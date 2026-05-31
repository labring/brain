import type { ContainerHistorySnapshotRow } from "@workspace/ui/components/container-history-pane/container-history-pane.types";
import { sortSnapshotRowsByCreatedAtDesc } from "@workspace/ui/components/container-history-pane/sort-snapshot-rows";

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

const CONFIG_SNAPSHOT_MARKER = "-config-snapshot-";

/** Hash suffix from `{ap}-config-snapshot-{hash}` ConfigMap names. */
function hashFromOrphanSnapshotName(cmName: string): string | undefined {
  const i = cmName.lastIndexOf(CONFIG_SNAPSHOT_MARKER);
  if (i === -1) {
    return undefined;
  }
  const h = cmName.slice(i + CONFIG_SNAPSHOT_MARKER.length).trim();
  return h === "" ? undefined : h;
}

function orphanSnapshotFromBackupEntry(
  item: unknown,
  activeHash: string | undefined,
  /** At most one row is marked active when hash matches `activeHash`. */
  activeConsumed: { value: boolean }
): ContainerHistorySnapshotRow | undefined {
  const row = asRecord(item);
  if (row == null) {
    return undefined;
  }
  const name = typeof row.name === "string" ? row.name : "";
  if (name === "" || !name.includes(CONFIG_SNAPSHOT_MARKER)) {
    return undefined;
  }
  const orphanHash = hashFromOrphanSnapshotName(name);
  const img = typeof row.image === "string" ? row.image : "";
  const createdAt = typeof row.createdAt === "string" ? row.createdAt : "";
  const matchesLive =
    activeHash != null &&
    orphanHash != null &&
    orphanHash === activeHash &&
    !activeConsumed.value;
  if (matchesLive) {
    activeConsumed.value = true;
  }
  return {
    configMapName: name,
    image: img,
    createdAt,
    variant: matchesLive ? "active" : "orphan",
    versionHash: orphanHash,
  };
}

/**
 * Orphan snapshot rows from `status.backups` only (no `{name}-config-backup` row).
 * The snapshot whose suffix matches `status.configVersionHash` is labeled **active**.
 */
export function apConfigSnapshotRowsFromClaim(
  body: Record<string, unknown> | undefined
): ContainerHistorySnapshotRow[] {
  if (body == null) {
    return [];
  }

  const status = asRecord(body.status);
  const hashRaw = status?.configVersionHash;
  const activeHash =
    typeof hashRaw === "string" && hashRaw.trim() !== ""
      ? hashRaw.trim()
      : undefined;

  const rawBackups = status?.backups;
  if (!Array.isArray(rawBackups) || rawBackups.length === 0) {
    return [];
  }

  const activeConsumed = { value: false };
  const rows: ContainerHistorySnapshotRow[] = [];
  for (const item of rawBackups) {
    const row = orphanSnapshotFromBackupEntry(item, activeHash, activeConsumed);
    if (row !== undefined) {
      rows.push(row);
    }
  }

  return sortSnapshotRowsByCreatedAtDesc(rows);
}
