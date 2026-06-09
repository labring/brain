import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  fetchDbServiceBackupProductResource,
  submitDbServiceBackupRestore,
  validateRestoredDbServiceName,
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
    return Response.json({
      metadata: { name: "orders-db" },
      status: { backups: [] },
    });
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

test("restore submit posts the completed backup and restored DB Service name", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedBody: unknown;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody = JSON.parse(String(init?.body));
    return Response.json({
      metadata: { name: "orders-restore" },
    });
  }) as typeof fetch;

  const response = await submitDbServiceBackupRestore({
    backupName: "orders-manual-20260609",
    backupNamespace: "database-system",
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
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
  globalThis.fetch = (() =>
    Response.json(
      {
        detail: "DB Service name already exists",
        status: 409,
        title: "DB Service name already exists",
      },
      { status: 409 }
    )) as typeof fetch;

  await assert.rejects(
    submitDbServiceBackupRestore({
      backupName: "orders-manual-20260609",
      backupNamespace: "database-system",
      kubeconfig: "kubeconfig",
      name: "orders-db",
      namespace: "database-system",
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
