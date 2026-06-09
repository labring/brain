import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  createDbServiceBackup,
  validateDbServiceBackupForm,
} from "./BackupServiceSurface";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("manual backup form validates name and description before submit", () => {
  assert.deepEqual(validateDbServiceBackupForm({ backupName: "" }), {
    backupName: "Backup Name is required.",
  });
  assert.deepEqual(
    validateDbServiceBackupForm({ backupName: "Orders_Backup" }),
    {
      backupName:
        "Backup Name must use lowercase letters, numbers, and hyphens, and start and end with a letter or number.",
    }
  );
  assert.deepEqual(
    validateDbServiceBackupForm({
      backupName: "orders-before-migration",
      description: "x".repeat(121),
    }),
    { description: "Description must be 120 characters or fewer." }
  );
  assert.deepEqual(
    validateDbServiceBackupForm({
      backupName: "orders-before-migration",
      description: "Before invoice migration",
    }),
    {}
  );
});

test("manual backup create posts name description and namespace with kubeconfig auth", async () => {
  let capturedUrl = "";
  let capturedAuth: string | null = null;
  let capturedBody: unknown;
  let refreshCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedAuth = new Headers(init?.headers).get("Authorization");
    capturedBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    return Response.json({
      metadata: { name: "orders-before-migration" },
    });
  }) as typeof fetch;

  const response = await createDbServiceBackup({
    backupName: "orders-before-migration",
    description: "Before invoice migration",
    kubeconfig: " kube config\n",
    name: "orders-db",
    namespace: "database-system",
    onAccepted: () => {
      refreshCount += 1;
    },
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
  assert.equal(refreshCount, 1);
});

test("manual backup create omits empty description", async () => {
  let capturedBody: unknown;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    return Response.json({});
  }) as typeof fetch;

  await createDbServiceBackup({
    backupName: "orders-before-migration",
    description: "   ",
    kubeconfig: "kube",
    name: "orders-db",
    namespace: "database-system",
  });

  assert.deepEqual(capturedBody, {
    backupName: "orders-before-migration",
    name: "orders-db",
    namespace: "database-system",
  });
});
