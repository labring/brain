/** One AP image version row for workload history UX. */
export interface ContainerHistorySnapshotRow {
  /** RFC3339 creation timestamp. */
  createdAt: string;
  /** Image captured for this version. */
  image: string;
  /** Image pull policy captured for this version. */
  imagePullPolicy?: string;
  /** Source operation that recorded this version. */
  source?: string;
  /** `active` when this version matches the current AP image. */
  variant: "active" | "orphan";
  /** Stable version hash returned by the AP version API. */
  versionHash: string;
}
