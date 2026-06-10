import type { DataBrowserDBServiceBackupSource } from "@data-browser/api/access-types";
import type { DataBrowserEngine } from "@data-browser/api/engine";

export type DbServiceBackupType = "Manual" | "Automatic";

export type DbServiceBackupStatus =
  | "Completed"
  | "Deleting"
  | "Failed"
  | "Pending"
  | "Running"
  | "Unknown";

export interface DbServiceBackupSummary {
  createdAt?: string;
  deletable: boolean;
  description?: string;
  duration?: string;
  failureReason?: string;
  name: string;
  namespace: string;
  restorable: boolean;
  size?: string;
  source: DataBrowserDBServiceBackupSource;
  startedAt?: string;
  status: DbServiceBackupStatus;
  type: DbServiceBackupType;
}

const SUPPORTED_BACKUP_ENGINES: ReadonlySet<DataBrowserEngine> = new Set([
  "POSTGRES",
  "MYSQL",
  "MONGODB",
  "REDIS",
]);

const DESCRIPTION_KEYS = [
  "brain.io/description",
  "app.brain.io/description",
  "description",
  "dataprotection.kubeblocks.io/description",
] as const;

const AUTOMATIC_LABEL_KEYS = [
  "dataprotection.kubeblocks.io/backup-policy",
  "backup-policy",
  "backupPolicy",
] as const;

const SPEC_DESCRIPTION_KEYS = ["description"] as const;
const BACKUP_TYPE_KEYS = ["brain.io/backup-type", "backupType"] as const;
const SPEC_BACKUP_TYPE_KEYS = ["type", "backupType"] as const;
const SPEC_BACKUP_POLICY_KEYS = ["backupPolicyName", "backupPolicy"] as const;
const STATUS_PHASE_KEYS = ["phase", "status", "state"] as const;
const START_TIME_KEYS = ["startTimestamp", "startedAt", "startTime"] as const;
const CREATION_TIME_KEYS = ["creationTimestamp"] as const;
const COMPLETION_TIME_KEYS = [
  "completionTimestamp",
  "completedAt",
  "endTimestamp",
  "endTime",
] as const;
const SIZE_KEYS = [
  "totalSize",
  "size",
  "backupSize",
  "dataSize",
  "volumeSnapshotSize",
] as const;
const FAILURE_REASON_KEYS = [
  "failureReason",
  "failureMessage",
  "reason",
  "message",
] as const;

const ACTIVE_STATUSES: ReadonlySet<DbServiceBackupStatus> = new Set([
  "Deleting",
  "Pending",
  "Running",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function firstString(
  record: Record<string, unknown> | undefined,
  keys: readonly string[]
): string | undefined {
  if (record === undefined) {
    return undefined;
  }
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function backupName(metadata: Record<string, unknown>): string {
  return nonEmptyString(metadata.name) ?? "unknown-backup";
}

function backupNamespace(
  metadata: Record<string, unknown>,
  source: DataBrowserDBServiceBackupSource
): string {
  return nonEmptyString(metadata.namespace) ?? source.namespace;
}

function backupDescription(
  metadata: Record<string, unknown>,
  spec: Record<string, unknown>
): string | undefined {
  return (
    firstString(asRecord(metadata.annotations), DESCRIPTION_KEYS) ??
    firstString(spec, SPEC_DESCRIPTION_KEYS)
  );
}

function backupType(
  metadata: Record<string, unknown>,
  spec: Record<string, unknown>
): DbServiceBackupType {
  const labels = asRecord(metadata.labels);
  const annotations = asRecord(metadata.annotations);
  const explicitType = (
    firstString(labels, BACKUP_TYPE_KEYS) ??
    firstString(annotations, BACKUP_TYPE_KEYS) ??
    firstString(spec, SPEC_BACKUP_TYPE_KEYS)
  )?.toLowerCase();

  if (explicitType === "automatic" || explicitType === "auto") {
    return "Automatic";
  }
  if (explicitType === "manual") {
    return "Manual";
  }

  if (
    firstString(labels, AUTOMATIC_LABEL_KEYS) !== undefined ||
    firstString(annotations, AUTOMATIC_LABEL_KEYS) !== undefined ||
    firstString(spec, SPEC_BACKUP_POLICY_KEYS) !== undefined
  ) {
    return "Automatic";
  }

  return "Manual";
}

function backupStatus(
  metadata: Record<string, unknown>,
  status: Record<string, unknown>
): DbServiceBackupStatus {
  if (nonEmptyString(metadata.deletionTimestamp) !== undefined) {
    return "Deleting";
  }

  const phase = firstString(status, STATUS_PHASE_KEYS)?.toLowerCase();

  switch (phase) {
    case "available":
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
      return "Completed";
    case "deleting":
    case "terminating":
      return "Deleting";
    case "failed":
    case "error":
      return "Failed";
    case "new":
    case "pending":
    case "queued":
      return "Pending";
    case "inprogress":
    case "in-progress":
    case "processing":
    case "running":
      return "Running";
    default:
      return "Unknown";
  }
}

function backupStartTime(
  metadata: Record<string, unknown>,
  status: Record<string, unknown>
): string | undefined {
  return (
    firstString(status, START_TIME_KEYS) ??
    firstString(metadata, CREATION_TIME_KEYS)
  );
}

function backupCreatedAt(
  metadata: Record<string, unknown>
): string | undefined {
  return firstString(metadata, CREATION_TIME_KEYS);
}

function backupCompletionTime(
  status: Record<string, unknown>
): string | undefined {
  return firstString(status, COMPLETION_TIME_KEYS);
}

function formatDuration(
  start: string | undefined,
  end: string | undefined
): string | undefined {
  if (start === undefined || end === undefined) {
    return undefined;
  }
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (
    !(Number.isFinite(startMs) && Number.isFinite(endMs)) ||
    endMs < startMs
  ) {
    return undefined;
  }

  const totalSeconds = Math.round((endMs - startMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(" ");
}

function backupDuration(status: Record<string, unknown>): string | undefined {
  const explicit = nonEmptyString(status.duration);
  if (explicit !== undefined) {
    return explicit;
  }
  return formatDuration(
    firstString(status, START_TIME_KEYS),
    backupCompletionTime(status)
  );
}

function backupSize(status: Record<string, unknown>): string | undefined {
  return firstString(status, SIZE_KEYS);
}

function backupFailureReason(
  status: Record<string, unknown>
): string | undefined {
  return firstString(status, FAILURE_REASON_KEYS);
}

function sortTime(summary: DbServiceBackupSummary): number {
  const parsed = Date.parse(summary.startedAt ?? summary.createdAt ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function stableBackupSort(
  left: DbServiceBackupSummary,
  right: DbServiceBackupSummary
): number {
  const byTime = sortTime(right) - sortTime(left);
  if (byTime !== 0) {
    return byTime;
  }
  return left.name.localeCompare(right.name);
}

function adaptDbServiceBackup(
  backup: unknown,
  source: DataBrowserDBServiceBackupSource
): DbServiceBackupSummary {
  const root = asRecord(backup) ?? {};
  const metadata = asRecord(root.metadata) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const status = asRecord(root.status) ?? {};
  const currentStatus = backupStatus(metadata, status);
  const createdAt = backupCreatedAt(metadata);
  const description = backupDescription(metadata, spec);
  const duration = backupDuration(status);
  const failureReason = backupFailureReason(status);
  const size = backupSize(status);
  const startedAt = backupStartTime(metadata, status);

  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    deletable: currentStatus === "Completed" || currentStatus === "Failed",
    ...(description === undefined ? {} : { description }),
    ...(duration === undefined ? {} : { duration }),
    ...(failureReason === undefined ? {} : { failureReason }),
    name: backupName(metadata),
    namespace: backupNamespace(metadata, source),
    restorable: currentStatus === "Completed",
    ...(size === undefined ? {} : { size }),
    source,
    ...(startedAt === undefined ? {} : { startedAt }),
    status: currentStatus,
    type: backupType(metadata, spec),
  } satisfies DbServiceBackupSummary;
}

export function isDbServiceBackupSupportedEngine(
  engine: DataBrowserEngine
): boolean {
  return SUPPORTED_BACKUP_ENGINES.has(engine);
}

export function dbServiceBackupNeedsRefresh(
  summaries: readonly DbServiceBackupSummary[]
): boolean {
  return summaries.some((backup) => ACTIVE_STATUSES.has(backup.status));
}

export function adaptDbServiceBackups({
  backups,
  source,
}: {
  backups: readonly unknown[] | undefined;
  source: DataBrowserDBServiceBackupSource;
}): DbServiceBackupSummary[] {
  return (backups ?? [])
    .map((backup) => adaptDbServiceBackup(backup, source))
    .sort(stableBackupSort);
}
