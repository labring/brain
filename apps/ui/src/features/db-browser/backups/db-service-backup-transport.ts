import type { DbServiceBackupFormValues } from "./db-service-backup-workflow";

const DB_PRODUCT_ROUTE = "/api/db/v1alpha1";
const DB_BACKUP_ROUTE = `${DB_PRODUCT_ROUTE}/backup`;
const DB_RESTORE_ROUTE = `${DB_PRODUCT_ROUTE}/restore`;

export interface DbServiceBackupTransport {
  createBackup(values: DbServiceBackupFormValues): Promise<unknown>;
  deleteBackup(input: { backupName: string }): Promise<unknown>;
  refreshDbService(): Promise<unknown>;
  restoreBackup(input: {
    backupName: string;
    backupNamespace: string;
    restoredName: string;
  }): Promise<unknown>;
  updatePolicy(input: {
    cronExpression?: string;
    enabled: boolean;
    retentionDays?: number;
  }): Promise<unknown>;
}

export interface DbServiceBackupFetchTransportOptions {
  kubeconfig: string;
  name: string;
  namespace: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
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

function authHeaders(kubeconfig: string): HeadersInit {
  return {
    Authorization: `Bearer ${encodeURIComponent(kubeconfig.trim())}`,
  };
}

function jsonHeaders(kubeconfig: string): HeadersInit {
  return {
    ...authHeaders(kubeconfig),
    "Content-Type": "application/json",
  };
}

function buildCreateBackupBody({
  backupName,
  description = "",
  name,
  namespace,
}: DbServiceBackupFormValues & {
  name: string;
  namespace: string;
}): Record<string, string> {
  const trimmedDescription = description.trim();
  return {
    backupName: backupName.trim(),
    ...(trimmedDescription === "" ? {} : { description: trimmedDescription }),
    name,
    namespace,
  };
}

export function createDbServiceBackupFetchTransport({
  kubeconfig,
  name,
  namespace,
}: DbServiceBackupFetchTransportOptions): DbServiceBackupTransport {
  return {
    async createBackup(values) {
      const response = await fetch(DB_BACKUP_ROUTE, {
        body: JSON.stringify(
          buildCreateBackupBody({
            ...values,
            name,
            namespace,
          })
        ),
        headers: jsonHeaders(kubeconfig),
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
      return response.json();
    },

    async deleteBackup({ backupName }) {
      const response = await fetch(DB_BACKUP_ROUTE, {
        body: JSON.stringify({
          backupName,
          name,
          namespace,
        }),
        headers: jsonHeaders(kubeconfig),
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
    },

    async refreshDbService() {
      const query = new URLSearchParams({
        name,
        namespace,
      });
      const response = await fetch(`${DB_PRODUCT_ROUTE}?${query.toString()}`, {
        headers: authHeaders(kubeconfig),
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
    },

    async restoreBackup({ backupName, backupNamespace, restoredName }) {
      const response = await fetch(DB_RESTORE_ROUTE, {
        body: JSON.stringify({
          backupName,
          backupNamespace,
          name,
          namespace,
          restoredName: restoredName.trim(),
        }),
        headers: jsonHeaders(kubeconfig),
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
    },

    async updatePolicy({ cronExpression, enabled, retentionDays }) {
      const response = await fetch(`${DB_PRODUCT_ROUTE}/backup/policy`, {
        body: JSON.stringify({
          ...(cronExpression === undefined ? {} : { cronExpression }),
          enabled,
          name,
          namespace,
          ...(retentionDays === undefined ? {} : { retentionDays }),
        }),
        headers: jsonHeaders(kubeconfig),
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
    },
  };
}
