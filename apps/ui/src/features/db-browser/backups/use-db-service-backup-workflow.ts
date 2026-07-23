"use client";

import type { DataBrowserHostContext } from "@db-browser/api/access-types";
import {
  backupPolicyFormToBackend,
  type DbServiceBackupPolicyBackend,
  type DbServiceBackupPolicyForm,
} from "@db-browser/backups/backup-policy-schedule";
import type { DbServiceBackupSummary } from "@db-browser/backups/backup-summary";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toastErrorDetail, toastPromiseDetail } from "@/lib/toast-utils";
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

interface PendingRefresh {
  count: number;
  refreshIdentity: string;
}

interface LastRefreshError {
  message: string;
  refreshIdentity: string;
}

export interface DbServiceBackupWorkflowNotifier {
  error(message: string, title?: string): void;
  promise<T>(
    promise: Promise<T>,
    messages: {
      error: (error: unknown) => string;
      errorTitle?: string;
      loading: string;
      success: string;
    }
  ): void;
}

const defaultNotifier: DbServiceBackupWorkflowNotifier = {
  error: (message, title = "Backup operation failed.") => {
    toastErrorDetail(title, message);
  },
  promise: (promise, messages) => {
    toastPromiseDetail(promise, {
      errorDescription: messages.error,
      errorTitle: messages.errorTitle ?? "Backup operation failed.",
      loading: messages.loading,
      success: messages.success,
    });
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
  const [pendingRefresh, setPendingRefresh] = useState<PendingRefresh | null>(
    null
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isPolicySaving, setIsPolicySaving] = useState(false);
  const activeRefreshIdentityRef = useRef<string | null>(null);
  const [optimisticallyDeletedBackups, setOptimisticallyDeletedBackups] =
    useState<OptimisticallyDeletedBackupNames | null>(null);
  const lastInitialRefreshIdentityRef = useRef<string | null>(null);
  const lastRefreshErrorRef = useRef<LastRefreshError | null>(null);
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
  // The identity is a pure join of stable fields, so recomputing on object
  // identity changes yields the same string.
  const refreshIdentity = useMemo(
    () =>
      dbServiceBackupRefreshIdentity({
        projectId: runtime.projectId,
        source: runtime.dbService,
      }),
    [runtime.dbService, runtime.projectId]
  );
  useEffect(() => {
    activeRefreshIdentityRef.current = refreshIdentity;
  }, [refreshIdentity]);
  const currentProductResource =
    latestProductResource?.refreshIdentity === refreshIdentity
      ? latestProductResource.value
      : null;
  const optimisticallyDeletedBackupNames =
    optimisticallyDeletedBackups?.refreshIdentity === refreshIdentity
      ? optimisticallyDeletedBackups.names
      : EMPTY_DELETED_BACKUP_NAMES;
  const isRefreshing =
    pendingRefresh?.refreshIdentity === refreshIdentity &&
    pendingRefresh.count > 0;
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
    const requestRefreshIdentity = refreshIdentity;
    setPendingRefresh((previous) => {
      if (previous?.refreshIdentity === requestRefreshIdentity) {
        return { ...previous, count: previous.count + 1 };
      }
      return { count: 1, refreshIdentity: requestRefreshIdentity };
    });
    try {
      const productResource = await activeTransport.refreshDbService();
      if (activeRefreshIdentityRef.current !== requestRefreshIdentity) {
        return;
      }
      setLatestProductResource({
        refreshIdentity: requestRefreshIdentity,
        value: productResource,
      });
      setOptimisticallyDeletedBackups({
        names: new Set(),
        refreshIdentity: requestRefreshIdentity,
      });
      if (
        lastRefreshErrorRef.current?.refreshIdentity === requestRefreshIdentity
      ) {
        lastRefreshErrorRef.current = null;
      }
    } catch (error) {
      if (activeRefreshIdentityRef.current !== requestRefreshIdentity) {
        return;
      }
      const message = errorMessage(error, "Failed to refresh backups.");
      if (
        lastRefreshErrorRef.current?.refreshIdentity !==
          requestRefreshIdentity ||
        lastRefreshErrorRef.current.message !== message
      ) {
        lastRefreshErrorRef.current = {
          message,
          refreshIdentity: requestRefreshIdentity,
        };
        notifier.error(message, "Could not refresh backups.");
      }
    } finally {
      setPendingRefresh((previous) => {
        if (previous?.refreshIdentity !== requestRefreshIdentity) {
          return previous;
        }
        return previous.count <= 1
          ? null
          : { ...previous, count: previous.count - 1 };
      });
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
        errorTitle: "Failed to create backup.",
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
          if (activeRefreshIdentityRef.current !== refreshIdentity) {
            return;
          }
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
        errorTitle: "Failed to delete backup.",
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
        errorTitle: "DB Service backup restore failed.",
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
        if (activeRefreshIdentityRef.current === refreshIdentity) {
          setLatestProductResource({ refreshIdentity, value: updated });
        }
        return dbServiceBackupPolicyFromProductResource(updated);
      })();
      notifier.promise(save, {
        error: (error) =>
          errorMessage(error, "Failed to update backup policy."),
        errorTitle: "Failed to update backup policy.",
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
      !state.supported ||
      lastInitialRefreshIdentityRef.current === refreshIdentity
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
