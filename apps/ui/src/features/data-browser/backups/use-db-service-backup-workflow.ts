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
  dbServiceBackupRefreshIdentity,
  deriveDbServiceBackupWorkflowState,
  shouldRequestDbServiceBackupInitialRefresh,
  validateRestoredDbServiceName,
} from "./db-service-backup-workflow";
import { requestDbServiceBackupDelete } from "./db-service-delete-request";
import { requestDbServiceRestore } from "./db-service-restore-request";

const EMPTY_DELETED_BACKUP_NAMES: ReadonlySet<string> = new Set();

interface LatestProductResource {
  refreshIdentity: string;
  value: unknown;
}

interface OptimisticallyDeletedBackupNames {
  names: ReadonlySet<string>;
  refreshIdentity: string;
}

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
    useState<LatestProductResource | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isPolicySaving, setIsPolicySaving] = useState(false);
  const [optimisticallyDeletedBackups, setOptimisticallyDeletedBackups] =
    useState<OptimisticallyDeletedBackupNames | null>(null);
  const lastInitialRefreshIdentityRef = useRef<string | null>(null);
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
  const refreshIdentity = useMemo(
    () =>
      dbServiceBackupRefreshIdentity({
        projectId: runtime.projectId,
        source: runtime.dbService,
      }),
    [
      runtime.dbService.name,
      runtime.dbService.namespace,
      runtime.dbService.uid,
      runtime.projectId,
    ]
  );
  const currentProductResource =
    latestProductResource?.refreshIdentity === refreshIdentity
      ? latestProductResource.value
      : null;
  const optimisticallyDeletedBackupNames =
    optimisticallyDeletedBackups?.refreshIdentity === refreshIdentity
      ? optimisticallyDeletedBackups.names
      : EMPTY_DELETED_BACKUP_NAMES;
  const state = useMemo(
    () =>
      deriveDbServiceBackupWorkflowState({
        dbServicePhase: runtime.dbServicePhase,
        engine: runtime.engine,
        initialBackups: runtime.backups,
        initialPolicy: runtime.backupPolicy,
        isRefreshing,
        optimisticallyDeletedBackupNames,
        productResource: currentProductResource,
        source: runtime.dbService,
      }),
    [
      currentProductResource,
      isRefreshing,
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
      setLatestProductResource({
        refreshIdentity,
        value: await activeTransport.refreshDbService(),
      });
      setOptimisticallyDeletedBackups({
        names: new Set(),
        refreshIdentity,
      });
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
  }, [activeTransport, notifier, refreshIdentity, state.supported]);

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
      const deletion = requestDbServiceBackupDelete({
        backupName,
        markBackupDeleted: (deletedBackupName) => {
          setOptimisticallyDeletedBackups((previous) => {
            const previousNames =
              previous?.refreshIdentity === refreshIdentity
                ? previous.names
                : EMPTY_DELETED_BACKUP_NAMES;
            const next = new Set(previousNames);
            next.add(deletedBackupName);
            return { names: next, refreshIdentity };
          });
        },
        refreshBackups: refresh,
        transport: activeTransport,
      });
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
    [activeTransport, notifier, refresh, refreshIdentity]
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
      const restore = requestDbServiceRestore({
        backup,
        refreshBackups: refresh,
        restoredName: trimmedRestoredName,
        runtime,
        transport: activeTransport,
      });
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
        setLatestProductResource({ refreshIdentity, value: updated });
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
    [activeTransport, notifier, refreshIdentity]
  );

  useEffect(() => {
    if (
      !shouldRequestDbServiceBackupInitialRefresh({
        lastRefreshIdentity: lastInitialRefreshIdentityRef.current,
        refreshIdentity,
        supported: state.supported,
      })
    ) {
      return;
    }

    lastInitialRefreshIdentityRef.current = refreshIdentity;
    refresh().catch(() => undefined);
  }, [refresh, refreshIdentity, state.supported]);

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
