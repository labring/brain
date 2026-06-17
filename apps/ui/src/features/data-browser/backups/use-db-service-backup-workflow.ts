"use client";

import type { DataBrowserHostContext } from "@data-browser/api/access-types";
import {
  backupPolicyFormToBackend,
  type DbServiceBackupPolicyBackend,
  type DbServiceBackupPolicyForm,
} from "@data-browser/backups/backup-policy-schedule";
import type { DbServiceBackupSummary } from "@data-browser/backups/backup-summary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createDbServiceBackupFetchTransport,
  type DbServiceBackupTransport,
} from "./db-service-backup-transport";
import {
  assertCanCreateManualBackup,
  assertCanDeleteDbServiceBackup,
  assertCanRestoreDbServiceBackup,
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  type DbServiceBackupFormValues,
  dbServiceBackupPolicyFromProductResource,
  deriveDbServiceBackupWorkflowState,
  validateRestoredDbServiceName,
} from "./db-service-backup-workflow";

export interface DbServiceBackupWorkflowNotifier {
  error(message: string): void;
  promise<T>(
    promise: Promise<T>,
    messages: {
      error: (error: unknown) => string;
      loading: string;
      success: string;
    }
  ): void;
}

const defaultNotifier: DbServiceBackupWorkflowNotifier = {
  error: (message) => toast.error(message),
  promise: (promise, messages) => {
    toast.promise(promise, messages);
  },
};

export interface UseDbServiceBackupWorkflowOptions {
  existingDbServiceNames?: readonly string[];
  notifier?: DbServiceBackupWorkflowNotifier;
  runtime: DataBrowserHostContext;
  transport?: DbServiceBackupTransport;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useDbServiceBackupWorkflow({
  existingDbServiceNames,
  notifier = defaultNotifier,
  runtime,
  transport,
}: UseDbServiceBackupWorkflowOptions) {
  const [latestProductResource, setLatestProductResource] =
    useState<unknown>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isPolicySaving, setIsPolicySaving] = useState(false);
  const [
    optimisticallyDeletedBackupNames,
    setOptimisticallyDeletedBackupNames,
  ] = useState<ReadonlySet<string>>(new Set());
  const lastRefreshErrorRef = useRef<string | null>(null);
  const fallbackTransport = useMemo(
    () =>
      createDbServiceBackupFetchTransport({
        kubeconfig: runtime.kubeconfig,
        name: runtime.databaseWorkloadName,
        namespace: runtime.databaseWorkloadNamespace,
      }),
    [
      runtime.databaseWorkloadName,
      runtime.databaseWorkloadNamespace,
      runtime.kubeconfig,
    ]
  );
  const activeTransport = transport ?? fallbackTransport;
  const projectDbServiceNames = useMemo(
    () => existingDbServiceNames ?? [runtime.databaseWorkloadName],
    [existingDbServiceNames, runtime.databaseWorkloadName]
  );
  const state = useMemo(
    () =>
      deriveDbServiceBackupWorkflowState({
        dbServicePhase: runtime.dbServicePhase,
        engine: runtime.engine,
        initialBackups: runtime.backups,
        initialPolicy: runtime.backupPolicy,
        isRefreshing,
        optimisticallyDeletedBackupNames,
        productResource: latestProductResource,
        source: runtime.dbService,
      }),
    [
      isRefreshing,
      latestProductResource,
      optimisticallyDeletedBackupNames,
      runtime.backupPolicy,
      runtime.backups,
      runtime.dbService,
      runtime.dbServicePhase,
      runtime.engine,
    ]
  );

  const refresh = useCallback(async () => {
    if (!state.supported) {
      return;
    }
    setIsRefreshing(true);
    try {
      setLatestProductResource(await activeTransport.refreshDbService());
      setOptimisticallyDeletedBackupNames(new Set());
      lastRefreshErrorRef.current = null;
    } catch (error) {
      const message = errorMessage(error, "Failed to refresh backups.");
      if (lastRefreshErrorRef.current !== message) {
        lastRefreshErrorRef.current = message;
        notifier.error(message);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [activeTransport, notifier, state.supported]);

  const createBackup = useCallback(
    async (values: DbServiceBackupFormValues) => {
      assertCanCreateManualBackup(state);
      setIsCreating(true);
      const trimmedName = values.backupName.trim();
      const submission = (async () => {
        await activeTransport.createBackup(values);
        await refresh();
      })();
      notifier.promise(submission, {
        error: (error) => errorMessage(error, "Failed to create backup."),
        loading: `Requesting backup ${trimmedName}...`,
        success: `Backup request accepted for ${trimmedName}.`,
      });
      try {
        await submission;
      } finally {
        setIsCreating(false);
      }
    },
    [activeTransport, notifier, refresh, state]
  );

  const deleteBackup = useCallback(
    async (backup: DbServiceBackupSummary) => {
      assertCanDeleteDbServiceBackup(backup);
      setIsDeleting(true);
      const backupName = backup.name;
      const deletion = (async () => {
        await activeTransport.deleteBackup({ backupName });
        setOptimisticallyDeletedBackupNames((previous) => {
          const next = new Set(previous);
          next.add(backupName);
          return next;
        });
        await refresh();
      })();
      notifier.promise(deletion, {
        error: (error) => errorMessage(error, "Failed to delete backup."),
        loading: `Deleting backup ${backupName}...`,
        success: `Deleted backup ${backupName}.`,
      });
      try {
        await deletion;
      } finally {
        setIsDeleting(false);
      }
    },
    [activeTransport, notifier, refresh]
  );

  const restoreBackup = useCallback(
    async (backup: DbServiceBackupSummary, restoredName: string) => {
      assertCanRestoreDbServiceBackup(backup);
      const trimmedRestoredName = restoredName.trim();
      const validationError = validateRestoredDbServiceName(
        trimmedRestoredName,
        projectDbServiceNames
      );
      if (validationError !== null) {
        throw new Error(validationError);
      }

      setIsRestoring(true);
      const restore = (async () => {
        await activeTransport.restoreBackup({
          backupName: backup.name,
          backupNamespace: backup.namespace,
          restoredName: trimmedRestoredName,
        });
        if (runtime.onDbServiceRestoreAccepted === undefined) {
          runtime.refreshProjectCanvas?.().catch(() => undefined);
        } else {
          runtime.onDbServiceRestoreAccepted({
            name: trimmedRestoredName,
            namespace: runtime.databaseWorkloadNamespace,
          });
        }
        await refresh();
      })();
      notifier.promise(restore, {
        error: (error) =>
          errorMessage(error, "DB Service backup restore failed."),
        loading: `Restoring DB Service ${trimmedRestoredName}...`,
        success: "Restore request accepted.",
      });
      try {
        await restore;
      } finally {
        setIsRestoring(false);
      }
    },
    [activeTransport, notifier, projectDbServiceNames, refresh, runtime]
  );

  const updatePolicy = useCallback(
    async (
      form: DbServiceBackupPolicyForm
    ): Promise<DbServiceBackupPolicyBackend | undefined> => {
      setIsPolicySaving(true);
      const save = (async () => {
        const backend = backupPolicyFormToBackend(form);
        const updated = await activeTransport.updatePolicy({
          cronExpression: backend.cronExpression,
          enabled: form.enabled,
          retentionDays: form.enabled ? form.retentionDays : undefined,
        });
        setLatestProductResource(updated);
        return dbServiceBackupPolicyFromProductResource(updated);
      })();
      notifier.promise(save, {
        error: (error) =>
          errorMessage(error, "Failed to update backup policy."),
        loading: "Saving backup policy...",
        success: form.enabled
          ? "Backup policy saved."
          : "Backup policy disabled.",
      });
      try {
        return await save;
      } finally {
        setIsPolicySaving(false);
      }
    },
    [activeTransport, notifier]
  );

  useEffect(() => {
    if (!state.needsRefresh) {
      return;
    }
    const interval = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh, state.needsRefresh]);

  return {
    commands: {
      createBackup,
      deleteBackup,
      refresh,
      restoreBackup,
      updatePolicy,
    },
    state: {
      ...state,
      existingDbServiceNames: projectDbServiceNames,
      isCreating,
      isDeleting,
      isPolicySaving,
      isRefreshing,
      isRestoring,
    },
  };
}
