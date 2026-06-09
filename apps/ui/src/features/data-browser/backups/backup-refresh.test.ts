import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  fetchDbServiceBackupProductResource,
  updateDbServiceBackupPolicy,
} from "./BackupServiceSurface";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

  const response = await fetchDbServiceBackupProductResource({
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
  });

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

  const response = await updateDbServiceBackupPolicy({
    cronExpression: "15 8 * * *",
    enabled: true,
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
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

  const response = await updateDbServiceBackupPolicy({
    enabled: false,
    kubeconfig: "kube",
    name: "orders-db",
    namespace: "database-system",
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
