import type { DataBrowserHostContext } from "@db-browser/api/access-types";
import type { DbServiceBackupSummary } from "@db-browser/backups/backup-summary";
import type { DbServiceBackupTransport } from "./db-service-backup-transport";

type DbServiceRestoreRuntime = Pick<
  DataBrowserHostContext,
  | "databaseWorkloadNamespace"
  | "onDbServiceRestoreAccepted"
  | "refreshProjectCanvas"
>;

export interface RequestDbServiceRestoreInput {
  backup: Pick<DbServiceBackupSummary, "name" | "namespace">;
  refreshBackups: () => Promise<unknown>;
  restoredName: string;
  runtime: DbServiceRestoreRuntime;
  transport: Pick<DbServiceBackupTransport, "restoreBackup">;
}

export async function requestDbServiceRestore({
  backup,
  refreshBackups,
  restoredName,
  runtime,
  transport,
}: RequestDbServiceRestoreInput): Promise<void> {
  await transport.restoreBackup({
    backupName: backup.name,
    backupNamespace: backup.namespace,
    restoredName,
  });

  if (runtime.onDbServiceRestoreAccepted === undefined) {
    runtime.refreshProjectCanvas?.().catch(() => undefined);
  } else {
    runtime.onDbServiceRestoreAccepted({
      name: restoredName,
      namespace: runtime.databaseWorkloadNamespace,
    });
  }

  refreshBackups().catch(() => undefined);
}
