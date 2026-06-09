"use client";

import {
  adaptDbServiceBackups,
  type DbServiceBackupSummary,
  dbServiceBackupNeedsRefresh,
  isDbServiceBackupSupportedEngine,
} from "@data-browser/backups/backup-summary";
import { Button } from "@data-browser/components/ui/Button";
import { cn } from "@data-browser/lib/utils";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export const DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS = 3000;
const DB_PRODUCT_ROUTE = "/api/db/v1alpha1";

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
    const text = await response.text();
    throw new Error(
      text.trim() ||
        `DB Service backup refresh failed with status ${response.status}`
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

function BackupRowsTable({ backups }: { backups: DbServiceBackupSummary[] }) {
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
          </tr>
        </thead>
        <tbody>
          {backups.map((backup) => (
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BackupServiceSurface() {
  const runtime = useDbAccessRuntime();
  const [refreshData, setRefreshData] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const summaries = useMemo(() => {
    const refreshedBackups = statusBackupsFromProductResource(refreshData);
    return adaptDbServiceBackups({
      backups: refreshedBackups ?? runtime.backups,
      source: runtime.dbService,
    });
  }, [refreshData, runtime.backups, runtime.dbService]);
  const needsRefresh = dbServiceBackupNeedsRefresh(summaries);
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

      <BackupRowsTable backups={summaries} />
    </section>
  );
}
