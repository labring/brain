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
import { Button } from "@data-browser/components/ui/Button";
import { ConfirmationModal } from "@data-browser/components/ui/ConfirmationModal";
import { Checkbox } from "@data-browser/components/ui/checkbox";
import { Dialog, DialogContent } from "@data-browser/components/ui/dialog";
import { Input } from "@data-browser/components/ui/Input";
import { ModalForm, useModalForm } from "@data-browser/components/ui/ModalForm";
import { Textarea } from "@data-browser/components/ui/Textarea";
import { cn } from "@data-browser/lib/utils";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import {
  CheckCircle2,
  DatabaseBackup,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useMemo,
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
  status,
}: {
  status: DbServiceBackupSummary["status"];
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 font-medium text-xs",
        statusTone(status)
      )}
    >
      {status}
    </span>
  );
}

function ActionState({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md border px-2 font-medium text-xs",
        enabled
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
          : "border-border bg-muted/20 text-muted-foreground"
      )}
    >
      {enabled ? "Available" : "Unavailable"}
    </span>
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

function BackupRowsTable({
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
  if (backups.length === 0) {
    return <EmptyBackupRows />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
      <table
        className="w-full min-w-[1120px] border-collapse text-left text-sm"
        data-qa-module="database"
        data-qa-object="backup-table"
        data-qa-state="ready"
        data-testid="database.backup.table"
      >
        <thead className="sticky top-0 z-10 bg-card text-muted-foreground text-xs">
          <tr className="border-border border-b">
            <th className="px-3 py-2 font-medium">{"Backup Name"}</th>
            <th className="px-3 py-2 font-medium">{"Description"}</th>
            <th className="px-3 py-2 font-medium">{"Type"}</th>
            <th className="px-3 py-2 font-medium">{"Status"}</th>
            <th className="px-3 py-2 font-medium">{"Created / Started"}</th>
            <th className="px-3 py-2 font-medium">{"Duration"}</th>
            <th className="px-3 py-2 font-medium">{"Size"}</th>
            <th className="px-3 py-2 font-medium">{"Failure Reason"}</th>
            <th className="px-3 py-2 font-medium">{"Restorable"}</th>
            <th className="px-3 py-2 font-medium">{"Deletable"}</th>
            <th className="px-3 py-2 font-medium">{"Source DB Service"}</th>
            <th className="px-3 py-2 font-medium">{"Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {backups.map((backup) => {
            const canDelete = backup.deletable && !isDeleting;
            return (
              <tr
                className="border-border border-b last:border-b-0"
                data-qa-module="database"
                data-qa-object="backup-row"
                data-qa-resource-id={backup.name}
                data-qa-resource-type="db-service-backup"
                data-qa-state={backup.status.toLowerCase()}
                data-testid="database.backup.row"
                key={`${backup.namespace}/${backup.name}`}
              >
                <td className="max-w-64 px-3 py-2 align-top font-medium">
                  <span className="block truncate">{backup.name}</span>
                </td>
                <td className="max-w-64 px-3 py-2 align-top text-muted-foreground">
                  <span className="block truncate">
                    {valueOrDash(backup.description)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">{backup.type}</td>
                <td className="px-3 py-2 align-top">
                  <BackupStatusBadge status={backup.status} />
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {formatDateTime(backup.startedAt ?? backup.createdAt)}
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {valueOrDash(backup.duration)}
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  {valueOrDash(backup.size)}
                </td>
                <td className="max-w-64 px-3 py-2 align-top text-muted-foreground">
                  <span className="block truncate">
                    {valueOrDash(backup.failureReason)}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <ActionState enabled={backup.restorable} />
                </td>
                <td className="px-3 py-2 align-top">
                  <ActionState enabled={backup.deletable} />
                </td>
                <td className="px-3 py-2 align-top text-muted-foreground">
                  <span className="block max-w-64 truncate">
                    {`${backup.source.namespace}/${backup.source.name}`}
                  </span>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex justify-end gap-2">
                    <Button
                      data-qa-action="restore"
                      data-qa-module="database"
                      data-qa-object="backup-row"
                      data-qa-resource-id={backup.name}
                      data-qa-state={backup.restorable ? "enabled" : "disabled"}
                      data-testid="database.backup.restore-button"
                      disabled={!backup.restorable}
                      onClick={() => onRestore(backup)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <DatabaseBackup className="h-4 w-4" />
                      {"Restore"}
                    </Button>
                    <Button
                      aria-label={`Delete backup ${backup.name}`}
                      data-qa-action="delete-backup"
                      data-qa-module="database"
                      data-qa-object="backup-row-action"
                      data-qa-resource-id={backup.name}
                      data-qa-state={canDelete ? "available" : "disabled"}
                      data-testid="database.backup.delete-button"
                      disabled={!canDelete}
                      onClick={() => onRequestDelete(backup)}
                      size="sm"
                      type="button"
                      variant="destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                      {"Delete"}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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
      className="rounded-md border border-border bg-card/40 p-3"
      data-qa-module="database"
      data-qa-object="backup-create-form"
      data-qa-state={disabled ? "disabled" : "ready"}
      data-testid="database.backup.create-form"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,280px)_minmax(260px,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <label
            className="mb-1.5 block font-medium text-[13px] leading-5"
            htmlFor="db-service-backup-name"
          >
            {"Backup Name"}
          </label>
          <Input
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
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label
              className="block font-medium text-[13px] leading-5"
              htmlFor="db-service-backup-description"
            >
              {"Description"}
            </label>
            <span className="text-[12px] text-muted-foreground leading-4">
              {`${descriptionLength}/${BACKUP_DESCRIPTION_MAX_LENGTH}`}
            </span>
          </div>
          <Textarea
            aria-invalid={errors.description === undefined ? undefined : true}
            className="min-h-9 resize-none"
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

        <Button
          className="mt-0 lg:mt-[26px]"
          data-qa-action="create"
          data-qa-module="database"
          data-qa-object="backup"
          data-qa-state={isSubmitting ? "loading" : "idle"}
          data-testid="database.backup.create-button"
          disabled={disabled || isSubmitting}
          size="sm"
          type="submit"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {"Create backup"}
        </Button>
      </div>

      {disabled && disabledReason !== undefined && (
        <p
          className="mt-2 mb-0 text-[13px] text-muted-foreground leading-5"
          data-testid="database.backup.create-disabled-reason"
        >
          {disabledReason}
        </p>
      )}

      {submitError !== null && (
        <div
          className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
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
          className="mt-2 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300"
          data-qa-module="database"
          data-qa-object="backup-create-accepted"
          data-qa-state="accepted"
          data-testid="database.backup.create-accepted"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{`Backup request accepted for ${acceptedName}.`}</span>
        </div>
      )}
    </form>
  );
}

interface RestoreModalContextValue {
  restoredName: string;
  setRestoredName: (name: string) => void;
  validationError: string | null;
}

const RestoreModalContext = createContext<RestoreModalContextValue | null>(
  null
);

function useRestoreModalContext(): RestoreModalContextValue {
  const context = use(RestoreModalContext);
  if (context === null) {
    throw new Error(
      "useRestoreModalContext must be used within RestoreModalProvider"
    );
  }
  return context;
}

function RestoreModalProvider({
  backup,
  children,
  existingNames,
  onSuccess,
}: {
  backup: DbServiceBackupSummary;
  children: ReactNode;
  existingNames: readonly string[];
  onSuccess: () => void;
}) {
  const runtime = useDbAccessRuntime();
  const [restoredName, setRestoredName] = useState("");
  const validationError = validateRestoredDbServiceName(
    restoredName,
    existingNames
  );
  const handleSubmit = useCallback(async () => {
    if (validationError !== null) {
      throw new Error(validationError);
    }
    await submitDbServiceBackupRestore({
      backupName: backup.name,
      backupNamespace: backup.namespace,
      kubeconfig: runtime.kubeconfig,
      name: runtime.databaseWorkloadName,
      namespace: runtime.databaseWorkloadNamespace,
      restoredName,
    });
    onSuccess();
  }, [
    backup.name,
    backup.namespace,
    onSuccess,
    restoredName,
    runtime.databaseWorkloadName,
    runtime.databaseWorkloadNamespace,
    runtime.kubeconfig,
    validationError,
  ]);

  return (
    <RestoreModalContext
      value={{
        restoredName,
        setRestoredName,
        validationError,
      }}
    >
      <ModalForm.Provider
        meta={{
          description: `${backup.namespace}/${backup.name}`,
          icon: DatabaseBackup,
          title: "Restore DB Service Backup",
        }}
        onSubmit={handleSubmit}
      >
        {children}
      </ModalForm.Provider>
    </RestoreModalContext>
  );
}

function RestoreModalFields() {
  const { restoredName, setRestoredName, validationError } =
    useRestoreModalContext();
  const { state } = useModalForm();

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-medium text-foreground text-sm">
        {"New DB Service name"}
      </label>
      <Input
        aria-invalid={validationError !== null}
        data-qa-module="database"
        data-qa-object="restore-name"
        data-qa-state={validationError === null ? "valid" : "invalid"}
        data-testid="database.backup.restore-name-input"
        disabled={state.isSubmitting}
        onChange={(event) => setRestoredName(event.target.value)}
        placeholder={"orders-restore"}
        value={restoredName}
      />
      {validationError !== null && (
        <p
          className="m-0 text-[13px] text-destructive leading-5"
          data-testid="database.backup.restore-name-error"
        >
          {validationError}
        </p>
      )}
    </div>
  );
}

function RestoreSubmitButton() {
  const { validationError } = useRestoreModalContext();
  return (
    <ModalForm.SubmitButton
      disabled={validationError !== null}
      label={"Restore"}
    />
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
  return (
    <Dialog onOpenChange={onOpenChange} open={backup !== null}>
      <DialogContent>
        {backup !== null && (
          <RestoreModalProvider
            backup={backup}
            existingNames={existingNames}
            onSuccess={onSuccess}
          >
            <ModalForm.Header />
            <RestoreModalFields />
            <ModalForm.Alert />
            <ModalForm.Footer>
              <ModalForm.CancelButton />
              <RestoreSubmitButton />
            </ModalForm.Footer>
          </RestoreModalProvider>
        )}
      </DialogContent>
    </Dialog>
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

function policySummary(form: DbServiceBackupPolicyForm): string {
  if (!form.enabled) {
    return "Automatic backups disabled";
  }
  if (form.frequency === "hourly") {
    return `Hourly at minute ${form.minute}`;
  }
  if (form.frequency === "daily") {
    return `Daily at ${String(form.hour).padStart(2, "0")}:${String(
      form.minute
    ).padStart(2, "0")}`;
  }
  const days = form.weekdays
    .map((weekday) => DB_SERVICE_BACKUP_WEEKDAY_LABELS[weekday])
    .join(", ");
  return `Weekly on ${days} at ${String(form.hour).padStart(2, "0")}:${String(
    form.minute
  ).padStart(2, "0")}`;
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
  onPolicySaved,
}: {
  initialPolicy: DbServiceBackupPolicyBackend | undefined;
  onPolicySaved: (data: unknown) => void;
}) {
  const runtime = useDbAccessRuntime();
  const [form, setForm] = useState<DbServiceBackupPolicyForm>(() =>
    backupPolicyFormFromBackend(initialPolicy)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retention = validateDbServiceBackupPolicyRetentionDays(
    form.retentionDays
  );

  useEffect(() => {
    setForm(backupPolicyFormFromBackend(initialPolicy));
  }, [initialPolicy]);

  const savePolicy = useCallback(
    async (nextForm: DbServiceBackupPolicyForm) => {
      setIsSaving(true);
      setError(null);
      try {
        const backend = backupPolicyFormToBackend(nextForm);
        const updated = await updateDbServiceBackupPolicy({
          cronExpression: backend.cronExpression,
          enabled: nextForm.enabled,
          kubeconfig: runtime.kubeconfig,
          name: runtime.databaseWorkloadName,
          namespace: runtime.databaseWorkloadNamespace,
          retentionDays: nextForm.enabled ? nextForm.retentionDays : undefined,
        });
        onPolicySaved(updated);
        setForm(
          backupPolicyFormFromBackend(
            specBackupPolicyFromProductResource(updated)
          )
        );
      } catch (saveError) {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Failed to update backup policy."
        );
      } finally {
        setIsSaving(false);
      }
    },
    [
      onPolicySaved,
      runtime.databaseWorkloadName,
      runtime.databaseWorkloadNamespace,
      runtime.kubeconfig,
    ]
  );
  const disablePolicy = useCallback(() => {
    const disabledForm = { ...form, enabled: false };
    setForm(disabledForm);
    savePolicy(disabledForm).catch(() => undefined);
  }, [form, savePolicy]);
  const saveEnabledPolicy = useCallback(() => {
    savePolicy({ ...form, enabled: true }).catch(() => undefined);
  }, [form, savePolicy]);
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
    <section
      className="rounded-md border border-border bg-card/40 p-3"
      data-qa-module="database"
      data-qa-object="backup-policy"
      data-qa-state={form.enabled ? "enabled" : "disabled"}
      data-testid="database.backup.policy"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 font-medium text-sm leading-5">
            {"Backup Policy"}
          </h3>
          <p className="mt-0.5 mb-0 text-[13px] text-muted-foreground leading-5">
            {`${policySummary(form)} • Retention ${form.retentionDays} days`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            data-qa-action="disable"
            data-qa-module="database"
            data-qa-object="backup-policy"
            disabled={isSaving || !form.enabled}
            onClick={disablePolicy}
            size="sm"
            type="button"
            variant="outline"
          >
            <XCircle className="h-4 w-4" />
            {"Disable"}
          </Button>
          <Button
            data-qa-action="save"
            data-qa-module="database"
            data-qa-object="backup-policy"
            disabled={isSaving || !retention.ok}
            onClick={saveEnabledPolicy}
            size="sm"
            type="button"
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving" : "Save"}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="text-muted-foreground">{"Frequency"}</span>
          <div className="grid grid-cols-3 rounded-md border border-border bg-background/40 p-0.5">
            {DB_SERVICE_BACKUP_POLICY_FREQUENCY_CHOICES.map((frequency) => (
              <button
                className={cn(
                  "h-8 rounded-[5px] px-2 font-medium text-xs",
                  form.frequency === frequency
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                )}
                data-qa-policy-frequency={frequency}
                key={frequency}
                onClick={() => setFrequency(frequency)}
                type="button"
              >
                {policyFrequencyLabel(frequency)}
              </button>
            ))}
          </div>
        </label>

        {form.frequency !== "hourly" && (
          <label className="flex min-w-0 flex-col gap-1 text-[13px]">
            <span className="text-muted-foreground">{"Hour"}</span>
            <Input
              max={TIME_FIELD_BOUNDS.hour.max}
              min={TIME_FIELD_BOUNDS.hour.min}
              onChange={(event) => setHour(event.currentTarget.value)}
              type="number"
              value={numberInputValue(form.hour)}
            />
          </label>
        )}

        <label className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="text-muted-foreground">{"Minute"}</span>
          <Input
            max={TIME_FIELD_BOUNDS.minute.max}
            min={TIME_FIELD_BOUNDS.minute.min}
            onChange={(event) => setMinute(event.currentTarget.value)}
            type="number"
            value={numberInputValue(form.minute)}
          />
        </label>

        <label className="flex min-w-0 flex-col gap-1 text-[13px]">
          <span className="text-muted-foreground">{"Retention"}</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onChange={(event) =>
              setRetentionDays(Number(event.currentTarget.value))
            }
            value={form.retentionDays}
          >
            {DB_SERVICE_BACKUP_RETENTION_DAY_CHOICES.map((days) => (
              <option key={days} value={days}>
                {`${days} days`}
              </option>
            ))}
          </select>
        </label>
      </div>

      {form.frequency === "weekly" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {DB_SERVICE_BACKUP_WEEKDAY_LABELS.map((label, weekday) => {
            const checked = form.weekdays.includes(weekday);
            return (
              <label
                className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-2 text-[13px]"
                key={label}
              >
                <Checkbox
                  checked={checked}
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
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[13px] text-destructive-foreground"
          data-qa-module="database"
          data-qa-object="backup-policy-error"
          data-testid="database.backup.policy-error"
        >
          {retention.message ?? error}
        </div>
      )}
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
      className="flex min-h-0 flex-1 flex-col gap-3 p-3 pt-0"
      data-qa-db-service-key={`${runtime.projectId}:${runtime.databaseWorkloadNamespace}:${runtime.databaseWorkloadName}`}
      data-qa-module="database"
      data-qa-object="backup-surface"
      data-qa-state={needsRefresh ? "refreshing" : "ready"}
      data-testid="database.backup.surface"
    >
      <div className="flex min-h-9 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 truncate font-medium text-sm leading-5">
            {"DB Service Backups"}
          </h2>
          <p className="mt-0.5 mb-0 truncate text-[13px] text-muted-foreground leading-5">
            {`${runtime.databaseWorkloadNamespace}/${runtime.databaseWorkloadName}`}
          </p>
        </div>
        <Button
          className="shrink-0"
          data-qa-action="refresh"
          data-qa-module="database"
          data-qa-object="backup-list"
          data-qa-state={isLoading ? "loading" : "idle"}
          data-testid="database.backup.refresh-button"
          onClick={() => {
            refresh().catch(() => undefined);
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          {"Refresh"}
        </Button>
      </div>

      <BackupPolicyForm
        initialPolicy={currentPolicy}
        onPolicySaved={setRefreshData}
      />

      <BackupCreationForm
        disabled={!running}
        disabledReason={createDisabledReason}
        isSubmitting={isCreating}
        onSubmit={createBackup}
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

      <BackupRowsTable
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
      <ConfirmationModal
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
