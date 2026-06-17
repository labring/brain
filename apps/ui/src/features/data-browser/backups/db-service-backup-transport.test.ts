import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { createDbServiceBackupFetchTransport } from "./db-service-backup-transport";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function transport() {
  return createDbServiceBackupFetchTransport({
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
  });
}

test("DB Service Backup transport creates manual backups with kubeconfig auth", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedBody: unknown;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    return Response.json({
      metadata: { name: "orders-before-migration" },
    });
  }) as typeof fetch;

  const response = await transport().createBackup({
    backupName: "orders-before-migration",
    description: "Before invoice migration",
  });

  assert.equal(capturedUrl, "/api/db/v1alpha1/backup");
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.deepEqual(capturedBody, {
    backupName: "orders-before-migration",
    description: "Before invoice migration",
    name: "orders-db",
    namespace: "database-system",
  });
  assert.deepEqual(response, {
    metadata: { name: "orders-before-migration" },
  });
});

test("DB Service Backup transport refreshes the DB product resource", async () => {
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

test("DB Service Backup transport restores completed backups", async () => {
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

test("DB Service Backup transport deletes selected backups", async () => {
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

test("DB Service Backup transport updates backup policy", async () => {
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

test("DB Service Backup transport reports API conflict detail", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      {
        detail: "DB Service Backup is not deletable",
        status: 409,
        title: "DB Service Backup is not deletable",
      },
      { status: 409 }
    )) as typeof fetch;

  await assert.rejects(
    transport().deleteBackup({
      backupName: "orders-running",
    }),
    /DB Service Backup is not deletable/
  );
});
