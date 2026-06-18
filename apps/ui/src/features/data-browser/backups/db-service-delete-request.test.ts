import assert from "node:assert/strict";
import { test } from "node:test";

import { requestDbServiceBackupDelete } from "./db-service-delete-request";

test("DB Service backup delete request resolves after delete is accepted before backup refresh finishes", async () => {
  let capturedDeleteInput: unknown;
  let deletedBackupName: string | undefined;
  let refreshStarted = false;
  let resolveRefresh: (() => void) | undefined;

  const refreshFinished = new Promise<void>((resolve) => {
    resolveRefresh = resolve;
  });

  const request = requestDbServiceBackupDelete({
    backupName: "orders-manual-20260609",
    markBackupDeleted: (backupName) => {
      deletedBackupName = backupName;
    },
    refreshBackups: () => {
      refreshStarted = true;
      return refreshFinished;
    },
    transport: {
      deleteBackup: async (input) => {
        capturedDeleteInput = input;
        return { status: "deleted" };
      },
    },
  });
  const result = await Promise.race([
    request.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 0);
    }),
  ]);

  assert.deepEqual(capturedDeleteInput, {
    backupName: "orders-manual-20260609",
  });
  assert.equal(deletedBackupName, "orders-manual-20260609");
  assert.equal(refreshStarted, true);

  resolveRefresh?.();
  await request;
  assert.equal(result, "resolved");
});
