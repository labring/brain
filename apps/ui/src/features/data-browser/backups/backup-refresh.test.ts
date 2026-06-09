import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  deleteDbServiceBackup,
  fetchDbServiceBackupProductResource,
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

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

test("backup deletion sends selected backup and source DB with kubeconfig auth", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedMethod = "";
  let capturedBody: unknown = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedMethod = init?.method ?? "";
    capturedBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    return Response.json({
      backupName: "orders-manual-20260609",
      namespace: "database-system",
      sourceDbName: "orders-db",
      status: "deleted",
    });
  }) as typeof fetch;

  const response = await deleteDbServiceBackup({
    backupName: "orders-manual-20260609",
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
  });

  assert.equal(capturedUrl, "/api/db/v1alpha1/backup");
  assert.equal(capturedAuth, "Bearer kube%20config");
  assert.equal(capturedMethod, "DELETE");
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
