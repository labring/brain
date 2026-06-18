import assert from "node:assert/strict";
import { test } from "node:test";

import { requestDbServiceRestore } from "./db-service-restore-request";

test("DB Service restore request resolves after restore is accepted before backup refresh finishes", async () => {
  let capturedRestoreInput: unknown;
  let focusTarget: unknown;
  let refreshStarted = false;
  let resolveRefresh: (() => void) | undefined;

  const refreshFinished = new Promise<void>((resolve) => {
    resolveRefresh = resolve;
  });

  const request = requestDbServiceRestore({
    backup: {
      name: "orders-manual-20260609",
      namespace: "database-system",
    },
    refreshBackups: () => {
      refreshStarted = true;
      return refreshFinished;
    },
    restoredName: "orders-restore",
    runtime: {
      databaseWorkloadNamespace: "database-system",
      onDbServiceRestoreAccepted: (target) => {
        focusTarget = target;
      },
    },
    transport: {
      restoreBackup: async (input) => {
        capturedRestoreInput = input;
        return { metadata: { name: "orders-restore" } };
      },
    },
  });
  const result = await Promise.race([
    request.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 0);
    }),
  ]);

  assert.deepEqual(capturedRestoreInput, {
    backupName: "orders-manual-20260609",
    backupNamespace: "database-system",
    restoredName: "orders-restore",
  });
  assert.deepEqual(focusTarget, {
    name: "orders-restore",
    namespace: "database-system",
  });
  assert.equal(refreshStarted, true);

  resolveRefresh?.();
  await request;
  assert.equal(result, "resolved");
});
