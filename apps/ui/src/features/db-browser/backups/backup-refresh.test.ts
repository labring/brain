import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createDbServiceBackupFetchTransport } from "./db-service-backup-transport";
import {
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  suggestedRestoredDbServiceName,
  validateRestoredDbServiceName,
} from "./db-service-backup-workflow";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function transport({
  kubeconfig = " kube config\n",
}: {
  kubeconfig?: string;
} = {}) {
  return createDbServiceBackupFetchTransport({
    kubeconfig,
    name: "orders-db",
    namespace: "database-system",
  });
}

test("DB Service backup active refresh interval is three seconds", () => {
  assert.equal(DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS, 3000);
});

test("manual backup refresh fetches the DB product resource with kubeconfig auth", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    return Promise.resolve(
      Response.json({
        metadata: { name: "orders-db" },
        status: { backups: [] },
      })
    );
  }) as typeof fetch;

  const response = await transport().refreshDbService();

  assert.equal(
    capturedUrl,
    "/api/db/v1alpha1?name=orders-db&namespace=database-system"
  );
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.deepEqual(response, {
    metadata: { name: "orders-db" },
    status: { backups: [] },
  });
});

test("restore submit posts the completed backup and restored DB Service name", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedBody: unknown;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({
      metadata: { name: "orders-restore" },
    });
  }) as typeof fetch;

  const response = await transport().restoreBackup({
    backupName: "orders-manual-20260609",
    backupNamespace: "database-system",
    restoredName: "orders-restore",
  });

  assert.equal(capturedUrl, "/api/db/v1alpha1/restore");
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.deepEqual(capturedBody, {
    backupName: "orders-manual-20260609",
    backupNamespace: "database-system",
    name: "orders-db",
    namespace: "database-system",
    restoredName: "orders-restore",
  });
  assert.deepEqual(response, {
    metadata: { name: "orders-restore" },
  });
});

test("restore submit reports API conflict detail", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      {
        detail: "DB Service name already exists",
        status: 409,
        title: "DB Service name already exists",
      },
      { status: 409 }
    )) as unknown as typeof fetch;

  await assert.rejects(
    transport({ kubeconfig: "kubeconfig" }).restoreBackup({
      backupName: "orders-manual-20260609",
      backupNamespace: "database-system",
      restoredName: "orders-restore",
    }),
    /DB Service name already exists/
  );
});

test("restored DB Service name validation matches lowercase DNS-style names", () => {
  assert.equal(validateRestoredDbServiceName("orders-restore"), null);
  assert.equal(
    validateRestoredDbServiceName(""),
    "DB Service name is required."
  );
  assert.equal(
    validateRestoredDbServiceName("Orders"),
    "Use lowercase letters, numbers, and hyphens. Start with a letter and end with a letter or number."
  );
  assert.equal(
    validateRestoredDbServiceName("orders-db", ["orders-db"]),
    "A DB Service with this name already exists."
  );
});

test("restored DB Service name suggestion avoids existing names", () => {
  assert.equal(
    suggestedRestoredDbServiceName("orders-db", [
      "orders-db",
      "orders-db-restore",
    ]),
    "orders-db-restore-2"
  );
  assert.equal(
    suggestedRestoredDbServiceName("123_orders", []),
    "db-123-orders-restore"
  );
});

test("DB Service backup delete posts selected backup and kubeconfig auth", async () => {
  let capturedBody: unknown;
  let capturedAuth: string | null = null;
  let capturedMethod: string | undefined;
  let capturedUrl = "";

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody = JSON.parse(String(init?.body));
    capturedMethod = init?.method;
    return Promise.resolve(
      Response.json({
        backupName: "orders-manual-20260609",
        namespace: "database-system",
        sourceDbName: "orders-db",
        status: "deleted",
      })
    );
  }) as typeof fetch;

  const response = await transport().deleteBackup({
    backupName: "orders-manual-20260609",
  });

  assert.equal(capturedUrl, "/api/db/v1alpha1/backup");
  assert.equal(capturedMethod, "DELETE");
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.deepEqual(capturedBody, {
    backupName: "orders-manual-20260609",
    name: "orders-db",
    namespace: "database-system",
  });
  assert.deepEqual(response, {
    backupName: "orders-manual-20260609",
    namespace: "database-system",
    sourceDbName: "orders-db",
    status: "deleted",
  });
});

test("DB Service backup delete reports API conflict detail", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      {
        detail: "DB Service Backup is not deletable",
        status: 409,
        title: "DB Service Backup is not deletable",
      },
      { status: 409 }
    )) as unknown as typeof fetch;

  await assert.rejects(
    transport({ kubeconfig: "kubeconfig" }).deleteBackup({
      backupName: "orders-running",
    }),
    /DB Service Backup is not deletable/
  );
});

test("DB Service backup policy update posts kubeconfig auth and policy payload", async () => {
  let capturedBody: unknown;
  let capturedAuth: string | null = null;
  let capturedMethod: string | undefined;
  let capturedUrl = "";

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody = JSON.parse(String(init?.body));
    capturedMethod = init?.method;
    return Promise.resolve(
      Response.json({
        metadata: { name: "orders-db" },
        spec: {
          backupPolicy: {
            cronExpression: "15 8 * * *",
            enabled: true,
            retentionPeriod: "7d",
          },
        },
        status: { backups: [] },
      })
    );
  }) as typeof fetch;

  const response = await transport().updatePolicy({
    cronExpression: "15 8 * * *",
    enabled: true,
    retentionDays: 7,
  });

  assert.equal(capturedUrl, "/api/db/v1alpha1/backup/policy");
  assert.equal(capturedMethod, "POST");
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.deepEqual(capturedBody, {
    cronExpression: "15 8 * * *",
    enabled: true,
    name: "orders-db",
    namespace: "database-system",
    retentionDays: 7,
  });
  assert.deepEqual(response, {
    metadata: { name: "orders-db" },
    spec: {
      backupPolicy: {
        cronExpression: "15 8 * * *",
        enabled: true,
        retentionPeriod: "7d",
      },
    },
    status: { backups: [] },
  });
});

test("DB Service backup policy disable preserves existing backup rows in returned resource", async () => {
  const existingBackups = [
    {
      metadata: {
        name: "orders-manual-20260609",
      },
      status: { phase: "Completed" },
    },
  ];
  let capturedBody: unknown;

  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return Promise.resolve(
      Response.json({
        metadata: { name: "orders-db" },
        spec: { backupPolicy: { enabled: false } },
        status: { backups: existingBackups },
      })
    );
  }) as typeof fetch;

  const response = await transport({ kubeconfig: "kube" }).updatePolicy({
    enabled: false,
  });

  assert.deepEqual(capturedBody, {
    enabled: false,
    name: "orders-db",
    namespace: "database-system",
  });
  assert.deepEqual(response, {
    metadata: { name: "orders-db" },
    spec: { backupPolicy: { enabled: false } },
    status: { backups: existingBackups },
  });
});
