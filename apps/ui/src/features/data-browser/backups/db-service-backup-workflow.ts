import type {
  DataBrowserDBServiceBackupPolicy,
  DataBrowserDBServiceBackupSource,
} from "@data-browser/api/access-types";
import type { DataBrowserEngine } from "@data-browser/api/engine";
import {
  adaptDbServiceBackups,
  type DbServiceBackupSummary,
  dbServiceBackupNeedsRefresh,
  isDbServiceBackupSupportedEngine,
} from "@data-browser/backups/backup-summary";
import type { DbServiceBackupPolicyBackend } from "./backup-policy-schedule";

export const DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS = 3000;

const BACKUP_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const BACKUP_DESCRIPTION_MAX_LENGTH = 120;
const DB_SERVICE_NAME_PATTERN = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

export interface DbServiceBackupFormValues {
  backupName: string;
  description?: string;
}

export type DbServiceBackupFormErrors = Partial<
  Record<keyof DbServiceBackupFormValues, string>
>;

export type DbServiceBackupWorkflowStatus =
  | "loading"
  | "ready"
  | "refreshing"
  | "unsupported";

export interface DbServiceBackupWorkflowState {
  backups: DbServiceBackupSummary[];
  canCreateManualBackup: boolean;
  manualBackupDisabledReason?: string;
  needsRefresh: boolean;
  policy?: DataBrowserDBServiceBackupPolicy;
  status: DbServiceBackupWorkflowStatus;
  supported: boolean;
}

export interface DbServiceBackupWorkflowStateInput {
  dbServicePhase?: string;
  engine: DataBrowserEngine;
  initialBackups?: readonly unknown[];
  initialPolicy?: DataBrowserDBServiceBackupPolicy;
  isRefreshing: boolean;
  optimisticallyDeletedBackupNames?: ReadonlySet<string>;
  productResource?: unknown;
  source: DataBrowserDBServiceBackupSource;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function localBackupTimestamp(now: Date): string {
  return [
    now.getFullYear(),
    padDatePart(now.getMonth() + 1),
    padDatePart(now.getDate()),
    "-",
    padDatePart(now.getHours()),
    padDatePart(now.getMinutes()),
    padDatePart(now.getSeconds()),
  ].join("");
}

function dnsNameBase({
  fallback,
  requireLetterStart = false,
  value,
}: {
  fallback: string;
  requireLetterStart?: boolean;
  value: string;
}): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized === "" ? fallback : normalized;
  return requireLetterStart && !/^[a-z]/.test(base)
    ? `${fallback}-${base}`.replace(/-+/g, "-").replace(/^-+|-+$/g, "")
    : base;
}

function dnsNameWithSuffix({
  fallback,
  requireLetterStart = false,
  suffix,
  value,
}: {
  fallback: string;
  requireLetterStart?: boolean;
  suffix: string;
  value: string;
}): string {
  const base = dnsNameBase({ fallback, requireLetterStart, value });
  const maxBaseLength = Math.max(1, 63 - suffix.length);
  const trimmedBase = base.slice(0, maxBaseLength).replace(/-+$/g, "");
  const safeBase =
    trimmedBase === "" || (requireLetterStart && !/^[a-z]/.test(trimmedBase))
      ? fallback
      : trimmedBase;
  return `${safeBase}${suffix}`.slice(0, 63).replace(/-+$/g, "");
}

export function suggestedDbServiceBackupName(
  sourceName: string,
  now = new Date()
): string {
  return dnsNameWithSuffix({
    fallback: "db",
    suffix: `-manual-${localBackupTimestamp(now)}`,
    value: sourceName,
  });
}

export function suggestedRestoredDbServiceName(
  sourceName: string,
  existingNames: readonly string[] = []
): string {
  const existing = new Set(existingNames.map((name) => name.trim()));
  const candidate = dnsNameWithSuffix({
    fallback: "db",
    requireLetterStart: true,
    suffix: "-restore",
    value: sourceName,
  });
  if (!existing.has(candidate)) {
    return candidate;
  }

  for (let index = 2; index < 1000; index += 1) {
    const suffix = `-${index}`;
    const next = `${candidate.slice(0, 63 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!existing.has(next)) {
      return next;
    }
  }
  return candidate;
}

export function validateDbServiceBackupForm({
  backupName,
  description = "",
}: DbServiceBackupFormValues): DbServiceBackupFormErrors {
  const errors: DbServiceBackupFormErrors = {};
  const trimmedName = backupName.trim();
  if (trimmedName === "") {
    errors.backupName = "Backup Name is required.";
  } else if (
    trimmedName.length > 63 ||
    !BACKUP_NAME_PATTERN.test(trimmedName)
  ) {
    errors.backupName =
      "Backup Name must use lowercase letters, numbers, and hyphens, and start and end with a letter or number.";
  }
  if ([...description.trim()].length > BACKUP_DESCRIPTION_MAX_LENGTH) {
    errors.description = "Description must be 120 characters or fewer.";
  }
  return errors;
}

export function validateRestoredDbServiceName(
  name: string,
  existingNames: readonly string[] = []
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "DB Service name is required.";
  }
  if (trimmed.length > 63 || !DB_SERVICE_NAME_PATTERN.test(trimmed)) {
    return "Use lowercase letters, numbers, and hyphens. Start with a letter and end with a letter or number.";
  }
  if (existingNames.some((existing) => existing.trim() === trimmed)) {
    return "A DB Service with this name already exists.";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function productResourceBody(
  data: unknown
): Record<string, unknown> | undefined {
  const root = asRecord(data);
  if (root === undefined) {
    return undefined;
  }
  return asRecord(root.data) ?? root;
}

function statusBackupsFromProductResource(
  data: unknown
): unknown[] | undefined {
  const root = productResourceBody(data);
  if (root === undefined) {
    return undefined;
  }

  const singleStatus = asRecord(root.status);
  if (Array.isArray(singleStatus?.backups)) {
    return singleStatus.backups;
  }
  return undefined;
}

export function dbServiceBackupPolicyFromProductResource(
  data: unknown
): DbServiceBackupPolicyBackend | undefined {
  const root = productResourceBody(data);
  const spec = asRecord(root?.spec);
  const backupPolicy = asRecord(spec?.backupPolicy);
  return backupPolicy === undefined
    ? undefined
    : (backupPolicy as DbServiceBackupPolicyBackend);
}

function isDbServiceRunning(phase: string | undefined): boolean {
  return phase?.trim().toLowerCase() === "running";
}

function backupWorkflowStatus({
  isRefreshing,
  needsRefresh,
  supported,
}: {
  isRefreshing: boolean;
  needsRefresh: boolean;
  supported: boolean;
}): DbServiceBackupWorkflowStatus {
  if (!supported) {
    return "unsupported";
  }
  if (isRefreshing) {
    return "loading";
  }
  if (needsRefresh) {
    return "refreshing";
  }
  return "ready";
}

export function deriveDbServiceBackupWorkflowState({
  dbServicePhase,
  engine,
  initialBackups,
  initialPolicy,
  isRefreshing,
  optimisticallyDeletedBackupNames = new Set(),
  productResource,
  source,
}: DbServiceBackupWorkflowStateInput): DbServiceBackupWorkflowState {
  const supported = isDbServiceBackupSupportedEngine(engine);
  const refreshedBackups = statusBackupsFromProductResource(productResource);
  const backups = adaptDbServiceBackups({
    backups: refreshedBackups ?? initialBackups,
    source,
  }).filter((backup) => !optimisticallyDeletedBackupNames.has(backup.name));
  const needsRefresh = dbServiceBackupNeedsRefresh(backups);
  const canCreateManualBackup = isDbServiceRunning(dbServicePhase);
  const manualBackupDisabledReason = canCreateManualBackup
    ? undefined
    : `Manual backup creation requires the source DB Service to be Running. Current state: ${dbServicePhase ?? "Unknown"}.`;

  return {
    backups,
    canCreateManualBackup,
    ...(manualBackupDisabledReason === undefined
      ? {}
      : { manualBackupDisabledReason }),
    needsRefresh,
    policy:
      dbServiceBackupPolicyFromProductResource(productResource) ??
      initialPolicy,
    status: backupWorkflowStatus({ isRefreshing, needsRefresh, supported }),
    supported,
  };
}

export function assertCanCreateManualBackup(
  state: Pick<
    DbServiceBackupWorkflowState,
    "canCreateManualBackup" | "manualBackupDisabledReason"
  >
) {
  if (!state.canCreateManualBackup) {
    throw new Error(
      state.manualBackupDisabledReason ??
        "Manual backup creation requires the source DB Service to be Running."
    );
  }
}

export function assertCanDeleteDbServiceBackup(
  backup: Pick<DbServiceBackupSummary, "deletable">
) {
  if (!backup.deletable) {
    throw new Error("DB Service Backup is not deletable.");
  }
}

export function assertCanRestoreDbServiceBackup(
  backup: Pick<DbServiceBackupSummary, "restorable">
) {
  if (!backup.restorable) {
    throw new Error("Only completed DB Service Backups can be restored.");
  }
}
