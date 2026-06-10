"use client";

import {
  backupPolicyFormFromBackend,
  backupPolicyFormToBackend,
  backupPolicyFormWithFrequency,
  DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES,
  DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES,
  DB_SERVICE_BACKUP_WEEKDAY_LABELS,
  type DbServiceBackupPolicyBackend,
  type DbServiceBackupPolicyForm,
  type DbServiceBackupPolicyFrequency,
  validateDbServiceBackupPolicyRetentionDays,
} from "@data-browser/backups/backup-policy-schedule";
import {
  adaptDbServiceBackups,
  type DbServiceBackupSummary,
  dbServiceBackupNeedsRefresh,
  isDbServiceBackupSupportedEngine,
} from "@data-browser/backups/backup-summary";
import { DbAccessConfirmationDialog } from "@data-browser/components/shared/DbAccessDialogs";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { SingleSelect } from "@workspace/ui/components/single-select";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArchiveRestore,
  CheckCircle2,
  CloudUpload,
  Info,
  List,
  Loader2,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export const DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS = 3000;
const DB_PRODUCT_ROUTE = "/api/db/v1alpha1";
const DB_BACKUP_ROUTE = `${DB_PRODUCT_ROUTE}/backup`;
const DB_RESTORE_ROUTE = `${DB_PRODUCT_ROUTE}/restore`;
const BACKUP_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const BACKUP_DESCRIPTION_MAX_LENGTH = 120;
const DB_SERVICE_NAME_PATTERN = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const TIME_FIELD_BOUNDS = {
  hour: { max: 23, min: 0 },
  minute: { max: 59, min: 0 },
} as const;
const HOUR_OPTIONS = Array.from(
  { length: TIME_FIELD_BOUNDS.hour.max + 1 },
  (_, index) => index
);
const MINUTE_OPTIONS = Array.from(
  { length: TIME_FIELD_BOUNDS.minute.max + 1 },
  (_, index) => index
);

export interface DbServiceBackupFormValues {
  backupName: string;
  description?: string;
}

export type DbServiceBackupFormErrors = Partial<
  Record<keyof DbServiceBackupFormValues, string>
>;

type DbServiceBackupRequest = DbServiceBackupFormValues & {
  kubeconfig: string;
  name: string;
  namespace: string;
  onAccepted?: () => void | Promise<void>;
};
type DbServiceBackupBodyInput = Pick<
  DbServiceBackupRequest,
  "backupName" | "description" | "name" | "namespace"
>;
type BackupSurfaceState = "loading" | "ready" | "refreshing";

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

function removeFormError(
  errors: DbServiceBackupFormErrors,
  key: keyof DbServiceBackupFormErrors
): DbServiceBackupFormErrors {
  if (errors[key] === undefined) {
    return errors;
  }
  const next = { ...errors };
  delete next[key];
  return next;
}

function buildCreateBackupBody({
  backupName,
  description = "",
  name,
  namespace,
}: DbServiceBackupBodyInput): Record<string, string> {
  const trimmedDescription = description.trim();
  return {
    backupName: backupName.trim(),
    ...(trimmedDescription === "" ? {} : { description: trimmedDescription }),
    name,
    namespace,
  };
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

function specBackupPolicyFromProductResource(
  data: unknown
): DbServiceBackupPolicyBackend | undefined {
  const root = productResourceBody(data);
  const spec = asRecord(root?.spec);
  const backupPolicy = asRecord(spec?.backupPolicy);
  return backupPolicy === undefined
    ? undefined
    : (backupPolicy as DbServiceBackupPolicyBackend);
}

function stringField(
  data: Record<string, unknown> | undefined,
  key: string
): string {
  const value = data?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function backupSurfaceState({
  isLoading,
  needsRefresh,
}: {
  isLoading: boolean;
  needsRefresh: boolean;
}): BackupSurfaceState {
  if (isLoading) {
    return "loading";
  }
  if (needsRefresh) {
    return "refreshing";
  }
  return "ready";
}

async function responseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const text = await response.text();
  const trimmed = text.trim();
  if (trimmed === "") {
    return fallback;
  }
  try {
    const body = asRecord(JSON.parse(trimmed));
    return (
      stringField(body, "detail") ||
      stringField(body, "message") ||
      stringField(body, "title") ||
      fallback
    );
  } catch {
    return trimmed;
  }
}

export async function createDbServiceBackup({
  kubeconfig,
  onAccepted,
  ...request
}: DbServiceBackupRequest): Promise<unknown> {
  const response = await fetch(DB_BACKUP_ROUTE, {
    body: JSON.stringify(buildCreateBackupBody(request)),
    headers: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(
        response,
        `DB Service backup creation failed with status ${response.status}`
      )
    );
  }
  const data = await response.json();
  await onAccepted?.();
  return data;
}

export async function fetchDbServiceBackupProductResource({
  kubeconfig,
  name,
  namespace,
}: {
  kubeconfig: string;
  name: string;
  namespace: string;
}): Promise<unknown> {
  const query = new URLSearchParams({
    name,
    namespace,
  });
  const response = await fetch(`${DB_PRODUCT_ROUTE}?${query.toString()}`, {
    headers: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
    },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(
        response,
        `DB Service backup refresh failed with status ${response.status}`
      )
    );
  }
  return response.json();
}

export async function deleteDbServiceBackup({
  backupName,
  kubeconfig,
  name,
  namespace,
}: {
  backupName: string;
  kubeconfig: string;
  name: string;
  namespace: string;
}): Promise<unknown> {
  const response = await fetch(DB_BACKUP_ROUTE, {
    body: JSON.stringify({
      backupName,
      name,
      namespace,
    }),
    headers: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
      "Content-Type": "application/json",
    },
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(
        response,
        `DB Service backup deletion failed with status ${response.status}`
      )
    );
  }
  return response.json();
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

export async function submitDbServiceBackupRestore({
  backupName,
  backupNamespace,
  kubeconfig,
  name,
  namespace,
  restoredName,
}: {
  backupName: string;
  backupNamespace: string;
  kubeconfig: string;
  name: string;
  namespace: string;
  restoredName: string;
}): Promise<unknown> {
  const response = await fetch(DB_RESTORE_ROUTE, {
    body: JSON.stringify({
      backupName,
      backupNamespace,
      name,
      namespace,
      restoredName: restoredName.trim(),
    }),
    headers: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(
        response,
        `DB Service restore failed with status ${response.status}`
      )
    );
  }
  return response.json();
}

export async function updateDbServiceBackupPolicy({
  cronExpression,
  enabled,
  kubeconfig,
  name,
  namespace,
  retentionDays,
}: {
  cronExpression?: string;
  enabled: boolean;
  kubeconfig: string;
  name: string;
  namespace: string;
  retentionDays?: number;
}): Promise<unknown> {
  const response = await fetch(`${DB_PRODUCT_ROUTE}/backup/policy`, {
    body: JSON.stringify({
      ...(cronExpression === undefined ? {} : { cronExpression }),
      enabled,
      name,
      namespace,
      ...(retentionDays === undefined ? {} : { retentionDays }),
    }),
    headers: {
      Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      await responseErrorMessage(
        response,
        `DB Service backup policy update failed with status ${response.status}`
      )
    );
  }
  return response.json();
}

function formatDateTime(value: string | undefined): string {
  if (value === undefined) {
    return "—";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function valueOrDash(value: string | undefined): string {
  return value === undefined || value.trim() === "" ? "—" : value;
}

function statusTone(status: DbServiceBackupSummary["status"]): string {
  switch (status) {
    case "Completed":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
    case "Failed":
      return "border-destructive/40 bg-destructive/10 text-destructive-foreground";
    case "Deleting":
    case "Pending":
    case "Running":
      return "border-blue-500/30 bg-blue-500/10 text-blue-300";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}

function BackupStatusBadge({
  className,
  status,
}: {
  className?: string;
  status: DbServiceBackupSummary["status"];
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 font-medium text-[11px] leading-4",
        statusTone(status),
        className
      )}
    >
      {status}
    </span>
  );
}

function backupDiagnosticItems(backup: DbServiceBackupSummary) {
  return [
    { label: "Backup", value: backup.name },
    {
      label: "Source",
      value: `${backup.source.namespace}/${backup.source.name}`,
    },
    {
      label: "Started",
      value: formatDateTime(backup.startedAt ?? backup.createdAt),
    },
    { label: "Duration", value: valueOrDash(backup.duration) },
    { label: "Size", value: valueOrDash(backup.size) },
    { label: "Failure", value: valueOrDash(backup.failureReason) },
    {
      label: "Restorable",
      value: backup.restorable ? "Available" : "Unavailable",
    },
    {
      label: "Deletable",
      value: backup.deletable ? "Available" : "Unavailable",
    },
  ];
}

function BackupStatusTooltip({ backup }: { backup: DbServiceBackupSummary }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex cursor-help items-center">
            <BackupStatusBadge status={backup.status} />
          </span>
        }
      />
      <TooltipContent
        arrow
        className="max-w-80 bg-zinc-950 text-zinc-100"
        side="bottom"
        sideOffset={0}
      >
        <div className="grid gap-1 text-left">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <Info className="size-3.5" />
            {"Backup status"}
          </div>
          {backupDiagnosticItems(backup).map((item) => (
            <div
              className="grid grid-cols-[72px_minmax(0,1fr)] gap-2 text-[11px] leading-4"
              key={item.label}
            >
              <span className="text-zinc-400">{item.label}</span>
              <span className="min-w-0 truncate text-zinc-100">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyBackupRows() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center rounded-md border border-border bg-card/40 p-8 text-center"
      data-qa-module="database"
      data-qa-object="backup-empty"
      data-qa-state="empty"
      data-testid="database.backup.empty"
    >
      <h3 className="m-0 font-medium text-sm leading-5">
        {"No backups found"}
      </h3>
      <p className="mt-1.5 mb-0 max-w-md text-[13px] text-muted-foreground leading-5">
        {"DB Service Backups for this service will appear here."}
      </p>
    </div>
  );
}

function backupTypeLabel(type: DbServiceBackupSummary["type"]): string {
  return type === "Manual" ? "Manual Backup" : "Auto Backup";
}

function backupRowMeta(backup: DbServiceBackupSummary): string {
  return [
    backup.source.name,
    backup.name,
    formatDateTime(backup.startedAt ?? backup.createdAt),
    valueOrDash(backup.duration),
    valueOrDash(backup.size),
  ].join(" / ");
}

function UnsupportedBackupSurface() {
  const runtime = useDbAccessRuntime();
  return (
    <div
      className="flex flex-1 items-center justify-center p-6"
      data-qa-module="database"
      data-qa-object="backup-unavailable"
      data-qa-state="unsupported"
      data-testid="database.backup.unavailable"
    >
      <div className="w-full max-w-md rounded-md border border-border bg-card p-4">
        <h3 className="m-0 font-medium text-sm leading-5">
          {"Backup unavailable"}
        </h3>
        <p className="mt-1.5 mb-0 text-[13px] text-muted-foreground leading-5">
          {`${runtime.database.displayEngine} DB Service Backups are not available in this version.`}
        </p>
      </div>
    </div>
  );
}

function BackupRowsList({
  backups,
  isDeleting,
  onRequestDelete,
  onRestore,
}: {
  backups: DbServiceBackupSummary[];
  isDeleting: boolean;
  onRequestDelete: (backup: DbServiceBackupSummary) => void;
  onRestore: (backup: DbServiceBackupSummary) => void;
}) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg bg-input/30"
      data-qa-module="database"
      data-qa-object="backup-list-surface"
      data-testid="database.backup.list-surface"
    >
      <div className="flex h-13 shrink-0 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <List className="size-3.5 shrink-0 text-muted-foreground" />
          <h3 className="m-0 truncate font-medium text-sm leading-5">
            {"Backup List"}
          </h3>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-muted-foreground text-sm leading-5">
          <span className="@min-[36rem]/backup-surface:inline hidden">
            {"Recent execution records"}
          </span>
        </div>
      </div>

      {backups.length === 0 ? (
        <div className="flex min-h-0 flex-1 p-4 pt-2">
          <EmptyBackupRows />
        </div>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-auto px-4 pb-4"
          data-qa-module="database"
          data-qa-object="backup-list"
          data-qa-state="ready"
          data-testid="database.backup.list"
        >
          <div className="flex flex-col gap-2">
            {backups.map((backup) => {
              const canDelete = backup.deletable && !isDeleting;
              return (
                <article
                  className="flex min-h-[74px] @min-[48rem]/backup-surface:flex-row flex-col @min-[48rem]/backup-surface:items-center items-stretch @min-[48rem]/backup-surface:justify-between gap-3 rounded-md bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.06]"
                  data-qa-module="database"
                  data-qa-object="backup-row"
                  data-qa-resource-id={backup.name}
                  data-qa-resource-type="db-service-backup"
                  data-qa-state={backup.status.toLowerCase()}
                  data-testid="database.backup.row"
                  key={`${backup.namespace}/${backup.name}`}
                >
                  <div className="min-w-0 @min-[48rem]/backup-surface:flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-sm leading-5">
                        {backupTypeLabel(backup.type)}
                      </span>
                      <BackupStatusTooltip backup={backup} />
                    </div>
                    <p className="mt-1 mb-0 truncate text-[12px] text-muted-foreground leading-4">
                      {backupRowMeta(backup)}
                    </p>
                  </div>

                  <div className="flex min-w-0 @min-[48rem]/backup-surface:shrink-0 flex-wrap items-center justify-end gap-2">
                    <AppButton
                      data-qa-action="restore"
                      data-qa-module="database"
                      data-qa-object="backup-row"
                      data-qa-resource-id={backup.name}
                      data-qa-state={backup.restorable ? "enabled" : "disabled"}
                      data-testid="database.backup.restore-button"
                      disabled={!backup.restorable}
                      onClick={() => onRestore(backup)}
                      type="button"
                      variant="secondary"
                    >
                      <ArchiveRestore />
                      {"Restore"}
                    </AppButton>
                    <AppIconButton
                      aria-label={`Delete backup ${backup.name}`}
                      data-qa-action="delete-backup"
                      data-qa-module="database"
                      data-qa-object="backup-row-action"
                      data-qa-resource-id={backup.name}
                      data-qa-state={canDelete ? "available" : "disabled"}
                      data-testid="database.backup.delete-button"
                      disabled={!canDelete}
                      onClick={() => onRequestDelete(backup)}
                      size="lg"
                      title={`Delete backup ${backup.name}`}
                      type="button"
                      variant="danger"
                    >
                      <Trash2 aria-hidden />
                    </AppIconButton>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

function isDbServiceRunning(phase: string | undefined): boolean {
  return phase?.trim().toLowerCase() === "running";
}

function BackupCreationForm({
  disabled,
  disabledReason,
  isSubmitting,
  onSubmit,
}: {
  disabled: boolean;
  disabledReason?: string;
  isSubmitting: boolean;
  onSubmit: (values: DbServiceBackupFormValues) => Promise<void>;
}) {
  const [backupName, setBackupName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<DbServiceBackupFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [acceptedName, setAcceptedName] = useState<string | null>(null);
  const descriptionLength = [...description].length;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);
    setAcceptedName(null);
    const nextErrors = validateDbServiceBackupForm({
      backupName,
      description,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const trimmedName = backupName.trim();
    onSubmit({ backupName: trimmedName, description })
      .then(() => {
        setBackupName("");
        setDescription("");
        setAcceptedName(trimmedName);
      })
      .catch((error: unknown) => {
        setSubmitError(
          error instanceof Error ? error.message : "Failed to create backup."
        );
      });
  };

  return (
    <form
      className="flex min-h-0 w-full flex-col"
      data-qa-module="database"
      data-qa-object="backup-create-form"
      data-qa-state={disabled ? "disabled" : "ready"}
      data-testid="database.backup.create-form"
      onSubmit={handleSubmit}
    >
      <div className="grid min-w-0 @min-[60rem]/backup-surface:grid-cols-[minmax(220px,320px)_minmax(260px,1fr)] gap-4">
        <div className="min-w-0">
          <label
            className="mb-2 block font-medium text-[13px] text-muted-foreground leading-5"
            htmlFor="db-service-backup-name"
          >
            {"Backup Name"}
          </label>
          <AppInput
            aria-invalid={errors.backupName === undefined ? undefined : true}
            autoComplete="off"
            data-testid="database.backup.name-input"
            disabled={disabled || isSubmitting}
            id="db-service-backup-name"
            maxLength={63}
            onChange={(event) => {
              setBackupName(event.target.value);
              setErrors((current) => removeFormError(current, "backupName"));
            }}
            placeholder="orders-before-migration"
            value={backupName}
          />
          {errors.backupName !== undefined && (
            <p
              className="mt-1 mb-0 text-[12px] text-destructive-foreground leading-4"
              data-testid="database.backup.name-error"
            >
              {errors.backupName}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label
              className="block font-medium text-[13px] text-muted-foreground leading-5"
              htmlFor="db-service-backup-description"
            >
              {"Description"}
            </label>
            <span className="text-[11px] text-muted-foreground leading-4">
              {`${descriptionLength}/${BACKUP_DESCRIPTION_MAX_LENGTH}`}
            </span>
          </div>
          <AppTextarea
            aria-invalid={errors.description === undefined ? undefined : true}
            className="min-h-9 min-w-0 resize-none border-input bg-transparent text-sm"
            data-testid="database.backup.description-input"
            disabled={disabled || isSubmitting}
            id="db-service-backup-description"
            maxLength={BACKUP_DESCRIPTION_MAX_LENGTH + 1}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrors((current) => removeFormError(current, "description"));
            }}
            placeholder="Optional reason for this recovery point"
            rows={1}
            value={description}
          />
          {errors.description !== undefined && (
            <p
              className="mt-1 mb-0 text-[12px] text-destructive-foreground leading-4"
              data-testid="database.backup.description-error"
            >
              {errors.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
        <div className="min-w-0">
          {disabled && disabledReason !== undefined ? (
            <p
              className="m-0 text-[12px] text-muted-foreground leading-4"
              data-testid="database.backup.create-disabled-reason"
            >
              {disabledReason}
            </p>
          ) : null}
        </div>

        <AppButton
          data-qa-action="create"
          data-qa-module="database"
          data-qa-object="backup"
          data-qa-state={isSubmitting ? "loading" : "idle"}
          data-testid="database.backup.create-button"
          disabled={disabled || isSubmitting}
          type="submit"
          variant="secondary"
        >
          {isSubmitting ? (
            <Loader2 className="animate-spin" />
          ) : (
            <CloudUpload />
          )}
          {"Backup"}
        </AppButton>
      </div>

      {submitError !== null && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
          data-qa-module="database"
          data-qa-object="backup-create-error"
          data-qa-state="error"
          data-testid="database.backup.create-error"
        >
          {submitError}
        </div>
      )}

      {acceptedName !== null && (
        <div
          className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300"
          data-qa-module="database"
          data-qa-object="backup-create-accepted"
          data-qa-state="accepted"
          data-testid="database.backup.create-accepted"
        >
          <CheckCircle2 className="size-4 shrink-0" />
          <span>{`Backup request accepted for ${acceptedName}.`}</span>
        </div>
      )}
    </form>
  );
}

function RestoreBackupModal({
  backup,
  existingNames,
  onOpenChange,
  onSuccess,
}: {
  backup: DbServiceBackupSummary | null;
  existingNames: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const runtime = useDbAccessRuntime();
  const [restoredName, setRestoredName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const validationError =
    backup === null
      ? null
      : validateRestoredDbServiceName(restoredName, existingNames);

  useEffect(() => {
    if (backup !== null) {
      setRestoredName("");
      setSubmitError(null);
      setIsSubmitting(false);
    }
  }, [backup]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (backup === null || validationError !== null || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await submitDbServiceBackupRestore({
        backupName: backup.name,
        backupNamespace: backup.namespace,
        kubeconfig: runtime.kubeconfig,
        name: runtime.databaseWorkloadName,
        namespace: runtime.databaseWorkloadNamespace,
        restoredName,
      });
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : "DB Service backup restore failed."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (!(isSubmitting && !open)) {
          onOpenChange(open);
        }
      }}
      open={backup !== null}
    >
      <AppDialog.Content aria-describedby={undefined}>
        {backup !== null && (
          <form onSubmit={handleSubmit}>
            <AppDialog.Header>
              <AppDialog.Icon>
                <ArchiveRestore aria-hidden />
              </AppDialog.Icon>
              <div className="min-w-0">
                <AppDialog.Title>{"Restore DB Service Backup"}</AppDialog.Title>
                <AppDialog.Description className="truncate">
                  {`${backup.namespace}/${backup.name}`}
                </AppDialog.Description>
              </div>
            </AppDialog.Header>
            <AppDialog.Body>
              <AppDialog.Field>
                <AppDialog.Label>{"New DB Service name"}</AppDialog.Label>
                <AppDialog.Input
                  aria-invalid={validationError !== null}
                  data-qa-module="database"
                  data-qa-object="restore-name"
                  data-qa-state={validationError === null ? "valid" : "invalid"}
                  data-testid="database.backup.restore-name-input"
                  disabled={isSubmitting}
                  onChange={(event) => setRestoredName(event.target.value)}
                  placeholder="orders-restore"
                  value={restoredName}
                />
                {validationError === null ? null : (
                  <p
                    className="m-0 text-[13px] text-destructive leading-5"
                    data-testid="database.backup.restore-name-error"
                  >
                    {validationError}
                  </p>
                )}
              </AppDialog.Field>
              {submitError === null ? null : (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
                  data-qa-module="database"
                  data-qa-object="backup-restore-error"
                  data-qa-state="error"
                  data-testid="database.backup.restore-error"
                >
                  {submitError}
                </div>
              )}
            </AppDialog.Body>
            <AppDialog.Footer>
              <AppDialog.Cancel disabled={isSubmitting}>
                {"Cancel"}
              </AppDialog.Cancel>
              <AppDialog.Action
                disabled={validationError !== null || isSubmitting}
                loading={isSubmitting}
                loadingLabel="Restoring..."
                type="submit"
              >
                {"Restore"}
              </AppDialog.Action>
            </AppDialog.Footer>
          </form>
        )}
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function policyFrequencyLabel(
  frequency: DbServiceBackupPolicyFrequency
): string {
  switch (frequency) {
    case "hourly":
      return "Hourly";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
  }
}

function timeOptionLabel(value: number): string {
  return String(value).padStart(2, "0");
}

function numberInputValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function parseBoundedInteger(
  value: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function uniqueSortedWeekdays(weekdays: number[]): number[] {
  return weekdays
    .filter((day, index, values) => values.indexOf(day) === index)
    .sort((left, right) => left - right);
}

function applyWeeklyDaySelection(
  currentWeekdays: number[],
  weekday: number,
  checked: boolean
): number[] {
  if (checked) {
    return uniqueSortedWeekdays([...currentWeekdays, weekday]);
  }

  const nextWeekdays = currentWeekdays.filter((day) => day !== weekday);
  return nextWeekdays.length === 0
    ? currentWeekdays
    : uniqueSortedWeekdays(nextWeekdays);
}

function BackupPolicyForm({
  initialPolicy,
  onPolicyEnabledChange,
  onPolicySaved,
  onPolicySavingChange,
  policyEnabled,
}: {
  initialPolicy: DbServiceBackupPolicyBackend | undefined;
  onPolicyEnabledChange: (enabled: boolean) => void;
  onPolicySaved: (data: unknown) => void;
  onPolicySavingChange: (isSaving: boolean) => void;
  policyEnabled: boolean;
}) {
  const runtime = useDbAccessRuntime();
  const [form, setForm] = useState<DbServiceBackupPolicyForm>(() => ({
    ...backupPolicyFormFromBackend(initialPolicy),
    enabled: policyEnabled,
  }));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retention = validateDbServiceBackupPolicyRetentionDays(
    form.retentionDays
  );

  useEffect(() => {
    setForm((current) => ({
      ...backupPolicyFormFromBackend(initialPolicy),
      enabled: current.enabled,
    }));
    setError(null);
  }, [initialPolicy]);

  useEffect(() => {
    setForm((current) =>
      current.enabled === policyEnabled
        ? current
        : { ...current, enabled: policyEnabled }
    );
  }, [policyEnabled]);

  useEffect(() => {
    onPolicySavingChange(isSaving);
  }, [isSaving, onPolicySavingChange]);

  useEffect(
    () => () => {
      onPolicySavingChange(false);
    },
    [onPolicySavingChange]
  );

  const resetPolicy = useCallback(() => {
    const nextForm = backupPolicyFormFromBackend(initialPolicy);
    setForm(nextForm);
    onPolicyEnabledChange(nextForm.enabled);
    setError(null);
  }, [initialPolicy, onPolicyEnabledChange]);

  const savePolicy = useCallback(async () => {
    setIsSaving(true);
    setError(null);
    try {
      const backend = backupPolicyFormToBackend(form);
      const updated = await updateDbServiceBackupPolicy({
        cronExpression: backend.cronExpression,
        enabled: form.enabled,
        kubeconfig: runtime.kubeconfig,
        name: runtime.databaseWorkloadName,
        namespace: runtime.databaseWorkloadNamespace,
        retentionDays: form.enabled ? form.retentionDays : undefined,
      });
      onPolicySaved(updated);
      const nextForm = backupPolicyFormFromBackend(
        specBackupPolicyFromProductResource(updated)
      );
      setForm(nextForm);
      onPolicyEnabledChange(nextForm.enabled);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to update backup policy."
      );
    } finally {
      setIsSaving(false);
    }
  }, [
    form,
    onPolicyEnabledChange,
    onPolicySaved,
    runtime.databaseWorkloadName,
    runtime.databaseWorkloadNamespace,
    runtime.kubeconfig,
  ]);
  const setFrequency = useCallback(
    (frequency: DbServiceBackupPolicyFrequency) => {
      setForm((current) => backupPolicyFormWithFrequency(current, frequency));
    },
    []
  );
  const setHour = useCallback((value: string) => {
    setForm((current) => {
      if (!("hour" in current)) {
        return current;
      }
      return {
        ...current,
        hour: parseBoundedInteger(
          value,
          current.hour,
          TIME_FIELD_BOUNDS.hour.min,
          TIME_FIELD_BOUNDS.hour.max
        ),
      };
    });
  }, []);
  const setMinute = useCallback((value: string) => {
    setForm((current) => ({
      ...current,
      minute: parseBoundedInteger(
        value,
        current.minute,
        TIME_FIELD_BOUNDS.minute.min,
        TIME_FIELD_BOUNDS.minute.max
      ),
    }));
  }, []);
  const setRetentionDays = useCallback((retentionDays: number) => {
    setForm((current) => ({ ...current, retentionDays }));
  }, []);
  const setWeeklyDay = useCallback((weekday: number, checked: boolean) => {
    setForm((current) => {
      if (current.frequency !== "weekly") {
        return current;
      }
      return {
        ...current,
        weekdays: applyWeeklyDaySelection(current.weekdays, weekday, checked),
      };
    });
  }, []);

  return (
    <div
      className="flex min-h-0 w-full flex-col"
      data-qa-module="database"
      data-qa-object="backup-policy"
      data-qa-state={form.enabled ? "enabled" : "disabled"}
      data-testid="database.backup.policy"
    >
      <div className="grid min-w-0 @min-[40rem]/backup-surface:grid-cols-2 gap-4">
        <label className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="font-medium text-muted-foreground leading-5">
            {"Backup Frequency"}
          </span>
          <SingleSelect
            className="w-full"
            disabled={!form.enabled || isSaving}
            onValueChange={(value) =>
              setFrequency(value as DbServiceBackupPolicyFrequency)
            }
            options={DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES.map(
              (frequency) => ({
                label: policyFrequencyLabel(frequency),
                value: frequency,
              })
            )}
            value={form.frequency}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="font-medium text-muted-foreground leading-5">
            {"Retention Period"}
          </span>
          <SingleSelect
            className="w-full"
            disabled={!form.enabled || isSaving}
            onValueChange={(value) => setRetentionDays(Number(value))}
            options={DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES.map((days) => ({
              label: `${days} Days`,
              value: String(days),
            }))}
            value={String(form.retentionDays)}
          />
        </label>

        {form.frequency !== "hourly" && (
          <label className="flex min-w-0 flex-col gap-1 text-[13px]">
            <span className="font-medium text-muted-foreground leading-5">
              {"Start Hour"}
            </span>
            <SingleSelect
              className="w-full"
              disabled={!form.enabled || isSaving}
              onValueChange={setHour}
              options={HOUR_OPTIONS.map((hour) => ({
                label: timeOptionLabel(hour),
                value: String(hour),
              }))}
              value={numberInputValue(form.hour)}
            />
          </label>
        )}

        <label
          className={cn(
            "flex min-w-0 flex-col gap-1 text-[13px]",
            form.frequency === "hourly" &&
              "@min-[40rem]/backup-surface:col-span-2"
          )}
        >
          <span className="font-medium text-muted-foreground leading-5">
            {"Start Minute"}
          </span>
          <SingleSelect
            className="w-full"
            disabled={!form.enabled || isSaving}
            onValueChange={setMinute}
            options={MINUTE_OPTIONS.map((minute) => ({
              label: timeOptionLabel(minute),
              value: String(minute),
            }))}
            value={numberInputValue(form.minute)}
          />
        </label>
      </div>

      {form.frequency === "weekly" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {DB_SERVICE_BACKUP_WEEKDAY_LABELS.map((label, weekday) => {
            const checked = form.weekdays.includes(weekday);
            return (
              <label
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-[13px] text-muted-foreground"
                key={label}
              >
                <Checkbox
                  checked={checked}
                  disabled={!form.enabled || isSaving}
                  onCheckedChange={(nextChecked) => {
                    setWeeklyDay(weekday, nextChecked === true);
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
      )}

      {(!retention.ok || error !== null) && (
        <div
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
          data-qa-module="database"
          data-qa-object="backup-policy-error"
          data-testid="database.backup.policy-error"
        >
          {retention.message ?? error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-4">
        <AppButton
          data-qa-action="reset"
          data-qa-module="database"
          data-qa-object="backup-policy"
          disabled={isSaving}
          onClick={resetPolicy}
          type="button"
          variant="secondary"
        >
          <RotateCcw />
          {"Reset"}
        </AppButton>
        <AppButton
          data-qa-action="save"
          data-qa-module="database"
          data-qa-object="backup-policy"
          disabled={isSaving || (form.enabled && !retention.ok)}
          onClick={() => {
            savePolicy().catch(() => undefined);
          }}
          type="button"
          variant="secondary"
        >
          {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
          {isSaving ? "Saving" : "Save"}
        </AppButton>
      </div>
    </div>
  );
}

type BackupMethodMode = "manual" | "policy";

function BackupMethodToggle({
  mode,
  onModeChange,
  onPolicyEnabledChange,
  policyEnabled,
  policySwitchDisabled,
}: {
  mode: BackupMethodMode;
  onModeChange: (mode: BackupMethodMode) => void;
  onPolicyEnabledChange: (enabled: boolean) => void;
  policyEnabled: boolean;
  policySwitchDisabled: boolean;
}) {
  const manualRef = useRef<HTMLButtonElement | null>(null);
  const policyRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState({ width: 0, x: 0 });
  const changePolicyEnabled = useCallback(
    (enabled: boolean) => {
      onModeChange("policy");
      onPolicyEnabledChange(enabled);
    },
    [onModeChange, onPolicyEnabledChange]
  );
  const updateIndicator = useCallback(() => {
    const selected = mode === "manual" ? manualRef.current : policyRef.current;
    const container = selected?.parentElement;
    if (selected == null || container == null) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();
    const nextIndicator = {
      width: selectedRect.width,
      x: selectedRect.left - containerRect.left,
    };
    setIndicator((current) =>
      Math.abs(current.width - nextIndicator.width) < 0.5 &&
      Math.abs(current.x - nextIndicator.x) < 0.5
        ? current
        : nextIndicator
    );
  }, [mode]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [policyEnabled, updateIndicator]);

  useEffect(() => {
    updateIndicator();
    const targets: Element[] = [];
    if (manualRef.current !== null) {
      targets.push(manualRef.current);
    }
    if (policyRef.current !== null) {
      targets.push(policyRef.current);
    }

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateIndicator);
      return () => {
        window.removeEventListener("resize", updateIndicator);
      };
    }

    const observer = new ResizeObserver(updateIndicator);
    for (const target of targets) {
      observer.observe(target);
    }
    return () => {
      observer.disconnect();
    };
  }, [updateIndicator]);

  const indicatorStyle = {
    opacity: indicator.width > 0 ? 1 : 0,
    transform: `translateX(${indicator.x}px)`,
    width: `${indicator.width}px`,
  } satisfies CSSProperties;

  return (
    <fieldset
      aria-label="Backup Method"
      className="relative m-0 mt-5 inline-flex h-9 w-fit max-w-full items-center self-start overflow-hidden rounded-lg bg-transparent p-0 shadow-[0_0_0_1px_var(--border)]"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-0 bg-input transition-[opacity,transform,width] duration-200 ease-out",
          mode === "manual"
            ? "rounded-r-lg rounded-l-none"
            : "rounded-r-none rounded-l-lg"
        )}
        data-slot="backup-method-toggle-indicator"
        style={indicatorStyle}
      />
      <button
        aria-pressed={mode === "manual"}
        className={cn(
          "relative z-10 inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-transparent px-4 text-sm transition-colors hover:bg-transparent",
          mode === "manual"
            ? "font-medium text-foreground"
            : "font-normal text-muted-foreground hover:text-foreground"
        )}
        data-qa-backup-method="manual"
        onClick={() => onModeChange("manual")}
        ref={manualRef}
        type="button"
      >
        {"Manual Backup"}
      </button>

      <div
        className={cn(
          "relative z-10 flex h-9 shrink-0 items-center gap-2 rounded-lg bg-transparent px-4 transition-colors",
          mode === "policy"
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        ref={policyRef}
      >
        <button
          aria-pressed={mode === "policy"}
          className={cn(
            "inline-flex h-full shrink-0 items-center justify-center bg-transparent text-sm",
            mode === "policy" ? "font-medium" : "font-normal"
          )}
          data-qa-backup-method="policy"
          onClick={() => onModeChange("policy")}
          type="button"
        >
          {"Backup Policy"}
        </button>
        <Switch
          aria-label="Auto Backup"
          checked={policyEnabled}
          className="shadow-none"
          disabled={policySwitchDisabled}
          onCheckedChange={changePolicyEnabled}
          size="lg"
          variant="brand"
        />
      </div>
    </fieldset>
  );
}

function BackupMethodPanel({
  createDisabled,
  createDisabledReason,
  currentPolicy,
  isCreating,
  onCreateBackup,
  onPolicySaved,
}: {
  createDisabled: boolean;
  createDisabledReason?: string;
  currentPolicy: DbServiceBackupPolicyBackend | undefined;
  isCreating: boolean;
  onCreateBackup: (values: DbServiceBackupFormValues) => Promise<void>;
  onPolicySaved: (data: unknown) => void;
}) {
  const initialPolicyEnabled = currentPolicy?.enabled === true;
  const [mode, setMode] = useState<BackupMethodMode>(() =>
    initialPolicyEnabled ? "policy" : "manual"
  );
  const [policyEnabled, setPolicyEnabled] = useState(initialPolicyEnabled);
  const [isPolicySaving, setIsPolicySaving] = useState(false);

  useEffect(() => {
    const nextPolicyEnabled = currentPolicy?.enabled === true;
    setPolicyEnabled(nextPolicyEnabled);
    if (nextPolicyEnabled) {
      setMode("policy");
    }
  }, [currentPolicy]);

  return (
    <section
      className="flex w-full min-w-0 flex-col rounded-lg bg-input/30 p-4"
      data-qa-module="database"
      data-qa-object="backup-method"
      data-qa-state={mode}
      data-testid="database.backup.method"
    >
      <div className="flex h-5 shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CloudUpload className="size-4 shrink-0 text-foreground" />
          <h3 className="m-0 truncate font-medium text-sm leading-5">
            {"Backup Method"}
          </h3>
        </div>
      </div>

      <BackupMethodToggle
        mode={mode}
        onModeChange={setMode}
        onPolicyEnabledChange={setPolicyEnabled}
        policyEnabled={policyEnabled}
        policySwitchDisabled={isPolicySaving}
      />

      <div className="mt-5 flex min-h-0 w-full min-w-0">
        {mode === "manual" ? (
          <BackupCreationForm
            disabled={createDisabled}
            disabledReason={createDisabledReason}
            isSubmitting={isCreating}
            onSubmit={onCreateBackup}
          />
        ) : (
          <BackupPolicyForm
            initialPolicy={currentPolicy}
            onPolicyEnabledChange={setPolicyEnabled}
            onPolicySaved={onPolicySaved}
            onPolicySavingChange={setIsPolicySaving}
            policyEnabled={policyEnabled}
          />
        )}
      </div>
    </section>
  );
}

export function BackupServiceSurface() {
  const runtime = useDbAccessRuntime();
  const [refreshData, setRefreshData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<string | null>(null);
  const [restoreBackup, setRestoreBackup] =
    useState<DbServiceBackupSummary | null>(null);
  const [selectedDeleteBackup, setSelectedDeleteBackup] =
    useState<DbServiceBackupSummary | null>(null);
  const [deletedBackupNames, setDeletedBackupNames] = useState<
    ReadonlySet<string>
  >(new Set());
  const currentPolicy =
    specBackupPolicyFromProductResource(refreshData) ?? runtime.backupPolicy;
  const summaries = useMemo(() => {
    const refreshedBackups = statusBackupsFromProductResource(refreshData);
    return adaptDbServiceBackups({
      backups: refreshedBackups ?? runtime.backups,
      source: runtime.dbService,
    }).filter((backup) => !deletedBackupNames.has(backup.name));
  }, [deletedBackupNames, refreshData, runtime.backups, runtime.dbService]);
  const needsRefresh = dbServiceBackupNeedsRefresh(summaries);
  const surfaceState = backupSurfaceState({ isLoading, needsRefresh });
  const deleteVerificationLabel =
    selectedDeleteBackup === null
      ? undefined
      : `Type ${selectedDeleteBackup.name} to confirm.`;
  const deleteConfirmationMessage =
    selectedDeleteBackup === null
      ? ""
      : `Delete Backup Name ${selectedDeleteBackup.name}. Only this recovery point will be removed; the source DB Service ${runtime.databaseWorkloadNamespace}/${runtime.databaseWorkloadName} and any restored DB Services remain unchanged.`;
  const refresh = useCallback(async () => {
    if (!isDbServiceBackupSupportedEngine(runtime.engine)) {
      return;
    }
    setIsLoading(true);
    setRefreshError(null);
    try {
      setRefreshData(
        await fetchDbServiceBackupProductResource({
          kubeconfig: runtime.kubeconfig,
          name: runtime.databaseWorkloadName,
          namespace: runtime.databaseWorkloadNamespace,
        })
      );
      setDeletedBackupNames(new Set());
    } catch (error) {
      setRefreshError(
        error instanceof Error ? error.message : "Failed to refresh backups."
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    runtime.databaseWorkloadName,
    runtime.databaseWorkloadNamespace,
    runtime.engine,
    runtime.kubeconfig,
  ]);
  const running = isDbServiceRunning(runtime.dbServicePhase);
  const createDisabledReason = running
    ? undefined
    : `Manual backup creation requires the source DB Service to be Running. Current state: ${runtime.dbServicePhase ?? "Unknown"}.`;
  const createBackup = useCallback(
    async (values: DbServiceBackupFormValues) => {
      setIsCreating(true);
      try {
        await createDbServiceBackup({
          ...values,
          kubeconfig: runtime.kubeconfig,
          name: runtime.databaseWorkloadName,
          namespace: runtime.databaseWorkloadNamespace,
          onAccepted: refresh,
        });
      } finally {
        setIsCreating(false);
      }
    },
    [
      refresh,
      runtime.databaseWorkloadName,
      runtime.databaseWorkloadNamespace,
      runtime.kubeconfig,
    ]
  );
  const requestDeleteBackup = useCallback((backup: DbServiceBackupSummary) => {
    if (!backup.deletable) {
      return;
    }
    setDeleteError(null);
    setSelectedDeleteBackup(backup);
  }, []);
  const confirmDeleteBackup = useCallback(async () => {
    if (selectedDeleteBackup === null) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteDbServiceBackup({
        backupName: selectedDeleteBackup.name,
        kubeconfig: runtime.kubeconfig,
        name: runtime.databaseWorkloadName,
        namespace: runtime.databaseWorkloadNamespace,
      });
      setDeletedBackupNames((previous) => {
        const next = new Set(previous);
        next.add(selectedDeleteBackup.name);
        return next;
      });
      setSelectedDeleteBackup(null);
      await refresh().catch((error) => {
        setRefreshError(
          error instanceof Error ? error.message : "Failed to refresh backups."
        );
      });
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "Failed to delete backup."
      );
    } finally {
      setIsDeleting(false);
    }
  }, [
    refresh,
    runtime.databaseWorkloadName,
    runtime.databaseWorkloadNamespace,
    runtime.kubeconfig,
    selectedDeleteBackup,
  ]);
  const existingDbServiceNames = useMemo(
    () => [runtime.databaseWorkloadName],
    [runtime.databaseWorkloadName]
  );
  const handleRestoreSuccess = useCallback(() => {
    setRestoreSuccess("Restore request accepted.");
    setRestoreBackup(null);
    runtime.refreshProjectCanvas?.().catch(() => undefined);
    refresh().catch(() => undefined);
  }, [refresh, runtime.refreshProjectCanvas]);

  useEffect(() => {
    if (!needsRefresh) {
      return;
    }
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [needsRefresh, refresh]);

  if (!isDbServiceBackupSupportedEngine(runtime.engine)) {
    return <UnsupportedBackupSurface />;
  }

  return (
    <section
      aria-busy={isLoading || undefined}
      className="@container/backup-surface flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2.5 px-3 pb-3"
      data-qa-db-service-key={`${runtime.projectId}:${runtime.databaseWorkloadNamespace}:${runtime.databaseWorkloadName}`}
      data-qa-module="database"
      data-qa-object="backup-surface"
      data-qa-state={surfaceState}
      data-testid="database.backup.surface"
    >
      <BackupMethodPanel
        createDisabled={!running}
        createDisabledReason={createDisabledReason}
        currentPolicy={currentPolicy}
        isCreating={isCreating}
        onCreateBackup={createBackup}
        onPolicySaved={setRefreshData}
      />

      {refreshError !== null && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
          data-qa-module="database"
          data-qa-object="backup-refresh-error"
          data-qa-state="error"
          data-testid="database.backup.refresh-error"
        >
          {refreshError}
        </div>
      )}

      {deleteError !== null && (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
          data-qa-module="database"
          data-qa-object="backup-delete-error"
          data-qa-state="error"
          data-testid="database.backup.delete-error"
        >
          {deleteError}
        </div>
      )}

      {restoreSuccess !== null && (
        <div
          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300"
          data-qa-module="database"
          data-qa-object="backup-restore-feedback"
          data-qa-state="accepted"
          data-testid="database.backup.restore-feedback"
        >
          {restoreSuccess}
        </div>
      )}

      <BackupRowsList
        backups={summaries}
        isDeleting={isDeleting}
        onRequestDelete={requestDeleteBackup}
        onRestore={setRestoreBackup}
      />
      <RestoreBackupModal
        backup={restoreBackup}
        existingNames={existingDbServiceNames}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreBackup(null);
          }
        }}
        onSuccess={handleRestoreSuccess}
      />
      <DbAccessConfirmationDialog
        cancelText="Cancel"
        confirmText="Delete"
        isDestructive
        isOpen={selectedDeleteBackup !== null}
        message={deleteConfirmationMessage}
        onClose={() => {
          if (!isDeleting) {
            setSelectedDeleteBackup(null);
          }
        }}
        onConfirm={confirmDeleteBackup}
        title="Delete DB Service Backup"
        verificationLabel={deleteVerificationLabel}
        verificationText={selectedDeleteBackup?.name}
      />
    </section>
  );
}
