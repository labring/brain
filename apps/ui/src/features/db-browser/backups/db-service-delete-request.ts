import type { DbServiceBackupTransport } from "./db-service-backup-transport";

export interface RequestDbServiceBackupDeleteInput {
  backupName: string;
  markBackupDeleted: (backupName: string) => void;
  refreshBackups: () => Promise<unknown>;
  transport: Pick<DbServiceBackupTransport, "deleteBackup">;
}

export async function requestDbServiceBackupDelete({
  backupName,
  markBackupDeleted,
  refreshBackups,
  transport,
}: RequestDbServiceBackupDeleteInput): Promise<void> {
  await transport.deleteBackup({ backupName });
  markBackupDeleted(backupName);
  refreshBackups().catch(() => undefined);
}
