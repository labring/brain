"use client";

import {
  backupPolicyFormFromBackend,
  backupPolicyFormWithFrequency,
  DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES,
  DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES,
  type DbServiceBackupPolicyBackend,
  type DbServiceBackupPolicyForm,
  type DbServiceBackupPolicyFrequency,
  validateDbServiceBackupPolicyRetentionDays,
} from "@data-browser/backups/backup-policy-schedule";
import type { DbServiceBackupSummary } from "@data-browser/backups/backup-summary";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppSelect } from "@workspace/ui/components/app-select";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { Switch } from "@workspace/ui/components/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArchiveRestore,
  CloudUpload,
  LayoutList,
  Loader2,
  RefreshCw,
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
  useRef,
  useState,
} from "react";
import {
  type DbServiceBackupFormErrors,
  type DbServiceBackupFormValues,
  suggestedDbServiceBackupName,
  suggestedRestoredDbServiceName,
  validateDbServiceBackupForm,
  validateRestoredDbServiceName,
} from "./db-service-backup-workflow";
import { useDbServiceBackupWorkflow } from "./use-db-service-backup-workflow";

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
const DB_SERVICE_BACKUP_WEEKDAY_SELECT_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const BACKUP_DESCRIPTION_MAX_LENGTH = 120;
const BACKUP_DESCRIPTION_INPUT_MAX_LENGTH = 1024;

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

function formatDateTime(value: string | undefined): string {
  if (value === undefined) {
    return "—";
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function statusTone(status: DbServiceBackupSummary["status"]): string {
  switch (status) {
    case "Completed":
      return "bg-emerald-500/30";
    case "Failed":
      return "bg-destructive/30";
    case "Deleting":
    case "Pending":
    case "Running":
      return "bg-blue-500/30";
    default:
      return "bg-muted/30";
  }
}

function backupStatusLabel(status: DbServiceBackupSummary["status"]): string {
  return status === "Running" ? "Backing up" : status;
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
        "inline-flex h-5 shrink-0 items-center rounded-full px-2.5 font-normal text-brand-primary-foreground text-xs leading-4",
        statusTone(status),
        className
      )}
      data-qa-object="backup-status-badge"
      data-qa-state={status.toLowerCase()}
    >
      {backupStatusLabel(status)}
    </span>
  );
}

function BackupStatus({ backup }: { backup: DbServiceBackupSummary }) {
  if (backup.status !== "Failed" || backup.failureReason === undefined) {
    return <BackupStatusBadge status={backup.status} />;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex shrink-0 cursor-help items-center leading-none"
            data-qa-object="backup-status-tooltip-trigger"
            data-qa-state="failed"
          >
            <BackupStatusBadge status={backup.status} />
          </span>
        }
      />
      <TooltipContent side="bottom">{backup.failureReason}</TooltipContent>
    </Tooltip>
  );
}

function EmptyBackupRows() {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center p-8 text-center"
      data-qa-module="database"
      data-qa-object="backup-empty"
      data-qa-state="empty"
      data-testid="database.backup.empty"
    >
      <h3 className="m-0 font-medium text-sm leading-5">
        {"No backups found"}
      </h3>
      <p className="mt-1.5 mb-0 max-w-md text-muted-foreground text-sm leading-5">
        {"DB Service Backups for this service will appear here."}
      </p>
    </div>
  );
}

function backupTypeLabel(type: DbServiceBackupSummary["type"]): string {
  return type === "Manual" ? "Manual" : "Automatic";
}

function backupTimeLabel(backup: DbServiceBackupSummary): string {
  return formatDateTime(backup.startedAt ?? backup.createdAt);
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
        <p className="mt-1.5 mb-0 text-muted-foreground text-sm leading-5">
          {`${runtime.database.displayEngine} DB Service Backups are not available in this version.`}
        </p>
      </div>
    </div>
  );
}

function BackupRowsList({
  backups,
  isDeleting,
  isRefreshing,
  onRequestDelete,
  onRefresh,
  onRestore,
}: {
  backups: DbServiceBackupSummary[];
  isDeleting: boolean;
  isRefreshing: boolean;
  onRequestDelete: (backup: DbServiceBackupSummary) => void;
  onRefresh: () => void;
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
          <LayoutList className="size-4 shrink-0 text-foreground" />
          <h3 className="m-0 truncate font-medium text-sm leading-5">
            {"Backup List"}
          </h3>
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <AppIconButton
                aria-label="Refresh Backup List"
                data-qa-action="refresh"
                data-qa-disabled-reason={
                  isRefreshing ? "refreshing" : undefined
                }
                data-qa-module="database"
                data-qa-object="backup-list"
                data-qa-state={isRefreshing ? "refreshing" : "ready"}
                data-testid="database.backup.refresh-button"
                disabled={isRefreshing}
                onClick={onRefresh}
                size="md"
                type="button"
                variant="quiet"
              >
                <RefreshCw
                  aria-hidden
                  className={cn("size-4", isRefreshing && "animate-spin")}
                />
              </AppIconButton>
            }
          />
          <TooltipContent>{"Refresh"}</TooltipContent>
        </Tooltip>
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
                  className="flex min-h-[74px] flex-row items-center justify-between gap-3 rounded-md bg-white/[0.04] px-4 py-3 transition-colors hover:bg-white/[0.06]"
                  data-qa-module="database"
                  data-qa-object="backup-row"
                  data-qa-resource-id={backup.name}
                  data-qa-resource-type="db-service-backup"
                  data-qa-state={backup.status.toLowerCase()}
                  data-testid="database.backup.row"
                  key={`${backup.namespace}/${backup.name}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="truncate font-medium text-sm leading-5"
                        data-qa-object="backup-row-name"
                      >
                        {backup.name}
                      </span>
                      <BackupStatus backup={backup} />
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground leading-4">
                      {backup.description === undefined ? null : (
                        <>
                          <span
                            className="min-w-0 truncate"
                            data-qa-object="backup-row-description"
                          >
                            {backup.description}
                          </span>
                          <span className="shrink-0">{"·"}</span>
                        </>
                      )}
                      <span
                        className="shrink-0"
                        data-qa-object="backup-row-time"
                      >
                        {backupTimeLabel(backup)}
                      </span>
                      <span className="shrink-0">{"·"}</span>
                      <span
                        className="shrink-0"
                        data-qa-object="backup-row-type"
                      >
                        {backupTypeLabel(backup.type)}
                      </span>
                    </div>
                  </div>

                  <div
                    className="flex min-w-0 shrink-0 items-center justify-end gap-2"
                    data-qa-object="backup-row-actions"
                    data-qa-resource-id={backup.name}
                  >
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

function BackupCreationForm({
  createDefaultBackupName,
  disabled,
  disabledReason,
  isSubmitting,
  onSubmit,
}: {
  createDefaultBackupName: () => string;
  disabled: boolean;
  disabledReason?: string;
  isSubmitting: boolean;
  onSubmit: (values: DbServiceBackupFormValues) => Promise<void>;
}) {
  const [backupName, setBackupName] = useState(createDefaultBackupName);
  const [isBackupNameEdited, setIsBackupNameEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<DbServiceBackupFormErrors>({});
  const descriptionLength = [...description].length;
  const isDescriptionOverLimit =
    descriptionLength > BACKUP_DESCRIPTION_MAX_LENGTH;
  const descriptionError = isDescriptionOverLimit
    ? "Description must be 120 characters or fewer."
    : errors.description;

  useEffect(() => {
    if (!isBackupNameEdited) {
      setBackupName(createDefaultBackupName());
    }
  }, [createDefaultBackupName, isBackupNameEdited]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateDbServiceBackupForm({
      backupName,
      description,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    const trimmedName = backupName.trim();
    const submission = onSubmit({ backupName: trimmedName, description }).then(
      () => {
        setBackupName(createDefaultBackupName());
        setIsBackupNameEdited(false);
        setDescription("");
      }
    );
    submission.catch(() => undefined);
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
            className="mb-2 block font-medium text-muted-foreground text-sm leading-5"
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
              setIsBackupNameEdited(true);
              setErrors((current) => removeFormError(current, "backupName"));
            }}
            placeholder="orders-before-migration"
            value={backupName}
          />
          {errors.backupName !== undefined && (
            <p
              className="mt-1 mb-0 text-[12px] text-destructive leading-4"
              data-testid="database.backup.name-error"
            >
              {errors.backupName}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label
              className="block font-medium text-muted-foreground text-sm leading-5"
              htmlFor="db-service-backup-description"
            >
              {"Description"}
            </label>
            <span
              className={
                isDescriptionOverLimit
                  ? "text-[11px] text-destructive leading-4"
                  : "text-[11px] text-muted-foreground leading-4"
              }
            >
              {`${descriptionLength}/${BACKUP_DESCRIPTION_MAX_LENGTH}`}
            </span>
          </div>
          <AppTextarea
            aria-invalid={descriptionError === undefined ? undefined : true}
            className="max-h-[7.25rem] min-h-9 min-w-0 resize-none overflow-y-auto border-input bg-transparent text-sm"
            data-testid="database.backup.description-input"
            disabled={disabled || isSubmitting}
            id="db-service-backup-description"
            maxLength={BACKUP_DESCRIPTION_INPUT_MAX_LENGTH}
            onChange={(event) => {
              setDescription(event.target.value);
              setErrors((current) => removeFormError(current, "description"));
            }}
            placeholder="Optional reason for this recovery point"
            rows={1}
            value={description}
          />
          {descriptionError !== undefined && (
            <p
              className="mt-1 mb-0 text-[12px] text-destructive leading-4"
              data-testid="database.backup.description-error"
            >
              {descriptionError}
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
          disabled={disabled || isSubmitting || isDescriptionOverLimit}
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
    </form>
  );
}

function RestoreBackupModal({
  backup,
  existingNames,
  isSubmitting,
  onOpenChange,
  onRestore,
  sourceName,
}: {
  backup: DbServiceBackupSummary | null;
  existingNames: readonly string[];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (
    backup: DbServiceBackupSummary,
    restoredName: string
  ) => Promise<void>;
  sourceName: string;
}) {
  const [restoredName, setRestoredName] = useState("");
  const validationError =
    backup === null
      ? null
      : validateRestoredDbServiceName(restoredName, existingNames);

  useEffect(() => {
    if (backup !== null) {
      setRestoredName(
        suggestedRestoredDbServiceName(sourceName, existingNames)
      );
    }
  }, [backup, existingNames, sourceName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (backup === null || validationError !== null || isSubmitting) {
      return;
    }

    const trimmedRestoredName = restoredName.trim();
    const submission = onRestore(backup, trimmedRestoredName).then(() => {
      onOpenChange(false);
    });
    try {
      await submission;
    } catch {
      // Error feedback is handled by the global toast.
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
              <AppDialog.Title>{"Restore DB Service Backup"}</AppDialog.Title>
              <AppDialog.Description className="truncate">
                {`${backup.namespace}/${backup.name}`}
              </AppDialog.Description>
            </AppDialog.Header>
            <AppDialog.Body>
              <AppDialog.Field>
                <AppDialog.Label>{"New DB Service Name"}</AppDialog.Label>
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
                    className="m-0 text-destructive text-sm leading-5"
                    data-testid="database.backup.restore-name-error"
                  >
                    {validationError}
                  </p>
                )}
              </AppDialog.Field>
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

function DeleteBackupModal({
  backup,
  isDeleting,
  onConfirm,
  onOpenChange,
  sourceName,
  sourceNamespace,
}: {
  backup: DbServiceBackupSummary | null;
  isDeleting: boolean;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
  sourceName: string;
  sourceNamespace: string;
}) {
  const [verificationValue, setVerificationValue] = useState("");

  useEffect(() => {
    if (backup !== null) {
      setVerificationValue("");
    }
  }, [backup]);

  if (backup === null) {
    return null;
  }

  const confirmDisabled = isDeleting || verificationValue !== backup.name;

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (isDeleting && !open) {
          return;
        }
        onOpenChange(open);
      }}
      open
    >
      <AppDialog.Content data-slot="db-service-backup-delete-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>{"Delete DB Service Backup?"}</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            {"This will delete "}
            <span className="font-medium text-foreground">{backup.name}</span>
            {
              ". Only this recovery point will be removed; the source DB Service "
            }
            <span className="font-mono text-foreground">
              {sourceNamespace}/{sourceName}
            </span>{" "}
            {"and any restored DB Services remain unchanged."}
          </AppDialog.Description>
          <AppDialog.Field>
            <p className="select-text text-sm/5 text-zinc-400">
              {"Type "}
              <span className="font-mono text-zinc-100">{backup.name}</span>
              {" to confirm."}
            </p>
            <AppDialog.Input
              aria-label={`Type ${backup.name} to confirm.`}
              autoComplete="off"
              className="font-mono"
              disabled={isDeleting}
              onChange={(event) => setVerificationValue(event.target.value)}
              placeholder={backup.name}
              type="text"
              value={verificationValue}
            />
          </AppDialog.Field>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={isDeleting}>{"Cancel"}</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            disabled={confirmDisabled}
            loading={isDeleting}
            loadingLabel="Deleting"
            onClick={() => {
              onConfirm().catch(() => undefined);
            }}
            type="button"
          >
            {"Delete"}
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
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

function BackupPolicyForm({
  initialPolicy,
  isSaving,
  onPolicyEnabledChange,
  onSavePolicy,
  policyEnabled,
}: {
  initialPolicy: DbServiceBackupPolicyBackend | undefined;
  isSaving: boolean;
  onPolicyEnabledChange: (enabled: boolean) => void;
  onSavePolicy: (
    form: DbServiceBackupPolicyForm
  ) => Promise<DbServiceBackupPolicyBackend | undefined>;
  policyEnabled: boolean;
}) {
  const [form, setForm] = useState<DbServiceBackupPolicyForm>(() => ({
    ...backupPolicyFormFromBackend(initialPolicy),
    enabled: policyEnabled,
  }));
  const retention = validateDbServiceBackupPolicyRetentionDays(
    form.retentionDays
  );

  useEffect(() => {
    setForm((current) => ({
      ...backupPolicyFormFromBackend(initialPolicy),
      enabled: current.enabled,
    }));
  }, [initialPolicy]);

  useEffect(() => {
    setForm((current) =>
      current.enabled === policyEnabled
        ? current
        : { ...current, enabled: policyEnabled }
    );
  }, [policyEnabled]);

  const resetPolicy = useCallback(() => {
    const nextForm = backupPolicyFormFromBackend(initialPolicy);
    setForm(nextForm);
    onPolicyEnabledChange(nextForm.enabled);
  }, [initialPolicy, onPolicyEnabledChange]);

  const savePolicy = useCallback(async () => {
    const save = onSavePolicy(form).then((updatedPolicy) => {
      const nextForm = backupPolicyFormFromBackend(updatedPolicy);
      setForm(nextForm);
      onPolicyEnabledChange(nextForm.enabled);
    });
    try {
      await save;
    } catch {
      // Error feedback is handled by the global toast.
    }
  }, [form, onPolicyEnabledChange, onSavePolicy]);
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
  const setWeekday = useCallback((value: string) => {
    setForm((current) => {
      if (current.frequency !== "weekly") {
        return current;
      }
      const weekday = parseBoundedInteger(
        value,
        current.weekdays[0] ?? 1,
        0,
        6
      );
      return {
        ...current,
        weekdays: [weekday],
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
      <div className="grid min-w-0 @min-[40rem]/backup-surface:grid-cols-2 gap-x-2 gap-y-4">
        <label className="flex min-w-0 flex-col gap-2 text-sm">
          <span className="font-medium text-muted-foreground leading-5">
            {"Backup Frequency"}
          </span>
          <AppSelect
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

        <label className="flex min-w-0 flex-col gap-2 text-sm">
          <span className="font-medium text-muted-foreground leading-5">
            {"Retention Period"}
          </span>
          <AppSelect
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

        {form.frequency === "weekly" && (
          <label className="@min-[40rem]/backup-surface:col-span-2 flex min-w-0 flex-col gap-2 text-sm">
            <span className="font-medium text-muted-foreground leading-5">
              {"Week"}
            </span>
            <AppSelect
              className="w-full"
              disabled={!form.enabled || isSaving}
              onValueChange={setWeekday}
              options={DB_SERVICE_BACKUP_WEEKDAY_SELECT_LABELS.map(
                (label, weekday) => ({
                  label,
                  value: String(weekday),
                })
              )}
              value={String(form.weekdays[0] ?? 1)}
            />
          </label>
        )}

        {form.frequency !== "hourly" && (
          <label className="flex min-w-0 flex-col gap-2 text-sm">
            <span className="font-medium text-muted-foreground leading-5">
              {"Start Hour"}
            </span>
            <AppSelect
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
            "flex min-w-0 flex-col gap-2 text-sm",
            form.frequency === "hourly" &&
              "@min-[40rem]/backup-surface:col-span-2"
          )}
        >
          <span className="font-medium text-muted-foreground leading-5">
            {"Start Minute"}
          </span>
          <AppSelect
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

      {!retention.ok && (
        <div
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive-foreground text-sm"
          data-qa-module="database"
          data-qa-object="backup-policy-error"
          data-testid="database.backup.policy-error"
        >
          {retention.message}
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
            : "font-normal text-muted-foreground"
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
          "relative z-10 flex h-9 shrink-0 items-center gap-2 rounded-lg bg-transparent pr-3 pl-4 transition-colors",
          mode === "policy" ? "text-foreground" : "text-muted-foreground"
        )}
        data-slot="backup-method-policy-segment"
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
  createDefaultBackupName,
  currentPolicy,
  isCreating,
  isPolicySaving,
  onCreateBackup,
  onSavePolicy,
}: {
  createDisabled: boolean;
  createDisabledReason?: string;
  createDefaultBackupName: () => string;
  currentPolicy: DbServiceBackupPolicyBackend | undefined;
  isCreating: boolean;
  isPolicySaving: boolean;
  onCreateBackup: (values: DbServiceBackupFormValues) => Promise<void>;
  onSavePolicy: (
    form: DbServiceBackupPolicyForm
  ) => Promise<DbServiceBackupPolicyBackend | undefined>;
}) {
  const initialPolicyEnabled = currentPolicy?.enabled === true;
  const [mode, setMode] = useState<BackupMethodMode>(() =>
    initialPolicyEnabled ? "policy" : "manual"
  );
  const [policyEnabled, setPolicyEnabled] = useState(initialPolicyEnabled);

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
            createDefaultBackupName={createDefaultBackupName}
            disabled={createDisabled}
            disabledReason={createDisabledReason}
            isSubmitting={isCreating}
            onSubmit={onCreateBackup}
          />
        ) : (
          <BackupPolicyForm
            initialPolicy={currentPolicy}
            isSaving={isPolicySaving}
            onPolicyEnabledChange={setPolicyEnabled}
            onSavePolicy={onSavePolicy}
            policyEnabled={policyEnabled}
          />
        )}
      </div>
    </section>
  );
}

export function BackupServiceSurface() {
  const runtime = useDbAccessRuntime();
  const { commands, state } = useDbServiceBackupWorkflow({ runtime });
  const [restoreBackup, setRestoreBackup] =
    useState<DbServiceBackupSummary | null>(null);
  const [selectedDeleteBackup, setSelectedDeleteBackup] =
    useState<DbServiceBackupSummary | null>(null);
  const createDefaultBackupName = useCallback(
    () => suggestedDbServiceBackupName(runtime.databaseWorkloadName),
    [runtime.databaseWorkloadName]
  );
  const requestDeleteBackup = useCallback((backup: DbServiceBackupSummary) => {
    if (!backup.deletable) {
      return;
    }
    setSelectedDeleteBackup(backup);
  }, []);
  const confirmDeleteBackup = useCallback(async () => {
    if (selectedDeleteBackup === null) {
      return;
    }
    try {
      await commands.deleteBackup(selectedDeleteBackup);
      setSelectedDeleteBackup(null);
    } catch {
      // Error feedback is handled by the global toast.
    }
  }, [commands, selectedDeleteBackup]);

  if (!state.supported) {
    return <UnsupportedBackupSurface />;
  }

  return (
    <section
      aria-busy={state.isRefreshing || undefined}
      className="@container/backup-surface flex min-h-0 w-full min-w-0 flex-1 flex-col gap-2.5 px-3 pb-3"
      data-qa-db-service-key={`${runtime.projectId}:${runtime.databaseWorkloadNamespace}:${runtime.databaseWorkloadName}`}
      data-qa-module="database"
      data-qa-object="backup-surface"
      data-qa-state={state.status}
      data-testid="database.backup.surface"
    >
      <BackupMethodPanel
        createDefaultBackupName={createDefaultBackupName}
        createDisabled={!state.canCreateManualBackup}
        createDisabledReason={state.manualBackupDisabledReason}
        currentPolicy={state.policy}
        isCreating={state.isCreating}
        isPolicySaving={state.isPolicySaving}
        onCreateBackup={commands.createBackup}
        onSavePolicy={commands.updatePolicy}
      />

      <BackupRowsList
        backups={state.backups}
        isDeleting={state.isDeleting}
        isRefreshing={state.isRefreshing}
        onRefresh={commands.refresh}
        onRequestDelete={requestDeleteBackup}
        onRestore={setRestoreBackup}
      />
      <RestoreBackupModal
        backup={restoreBackup}
        existingNames={state.existingDbServiceNames}
        isSubmitting={state.isRestoring}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreBackup(null);
          }
        }}
        onRestore={commands.restoreBackup}
        sourceName={runtime.databaseWorkloadName}
      />
      <DeleteBackupModal
        backup={selectedDeleteBackup}
        isDeleting={state.isDeleting}
        onConfirm={confirmDeleteBackup}
        onOpenChange={(open) => {
          if (!(state.isDeleting || open)) {
            setSelectedDeleteBackup(null);
          }
        }}
        sourceName={runtime.databaseWorkloadName}
        sourceNamespace={runtime.databaseWorkloadNamespace}
      />
    </section>
  );
}
