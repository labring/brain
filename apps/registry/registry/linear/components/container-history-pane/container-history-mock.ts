import type { ContainerHistorySnapshotRow } from "@workspace/ui/components/container-history-pane/container-history-pane.types";
import { sortSnapshotRowsByCreatedAtDesc } from "@workspace/ui/components/container-history-pane/sort-snapshot-rows";

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

/**
 * Mock image versions for registry previews.
 * The first hash acts as the active AP image version.
 */
export function mockApConfigSnapshotRows(): ContainerHistorySnapshotRow[] {
  /** Ten retained AP image versions. */
  const snapshotHashes = [
    "deadbeefcafe",
    "9a8b7c6d5e4f",
    "badc0ffee0dd",
    "c0ffeef00dba",
    "f00dbabe1234",
    "aabbccddee01",
    "112233445566",
    "998877665544",
    "feedfacecafe",
    "0102030405ab",
  ] as const;

  const liveHash = snapshotHashes[0];

  const orphans: ContainerHistorySnapshotRow[] = snapshotHashes.map(
    (hash, index) => {
      const source = index !== 0 && index % 3 === 0 ? "rollback" : "update";
      return {
        variant: hash === liveHash ? ("active" as const) : ("orphan" as const),
        versionHash: hash,
        image:
          index % 4 === 3
            ? ""
            : `ghcr.io/sealai/orders-api:2026.03.${String(31 - index).padStart(2, "0")}`,
        createdAt: isoHoursAgo(6 * (index + 1)),
        imagePullPolicy: "Always",
        source,
      };
    }
  );

  return sortSnapshotRowsByCreatedAtDesc(orphans);
}
