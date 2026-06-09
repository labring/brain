import assert from "node:assert/strict";
import { test } from "node:test";

import {
  adaptDbServiceBackups,
  dbServiceBackupNeedsRefresh,
  isDbServiceBackupSupportedEngine,
} from "./backup-summary";

const source = {
  name: "orders-db",
  namespace: "database-system",
  uid: "cluster-uid-1",
};

test("adapts raw DB Service backup resources into stable summaries", () => {
  const summaries = adaptDbServiceBackups({
    backups: [
      {
        metadata: {
          annotations: {
            "brain.io/description": "Before invoice migration",
          },
          creationTimestamp: "2026-06-09T05:00:00Z",
          name: "orders-manual-newer",
          namespace: "database-system",
        },
        spec: {
          backupMethod: "postgres-basebackup",
        },
        status: {
          completionTimestamp: "2026-06-09T05:03:00Z",
          phase: "Completed",
          startTimestamp: "2026-06-09T05:00:30Z",
          totalSize: "10Gi",
        },
      },
      {
        metadata: {
          creationTimestamp: "2026-06-09T04:00:00Z",
          labels: {
            "dataprotection.kubeblocks.io/backup-policy": "daily",
          },
          name: "orders-auto-older",
          namespace: "database-system",
        },
        spec: {
          backupMethod: "postgres-basebackup",
        },
        status: {
          failureReason: "volume snapshot failed",
          phase: "Failed",
          startTimestamp: "2026-06-09T04:01:00Z",
        },
      },
    ],
    source,
  });

  assert.deepEqual(
    summaries.map((backup) => backup.name),
    ["orders-manual-newer", "orders-auto-older"]
  );
  assert.equal(summaries[0]?.description, "Before invoice migration");
  assert.equal(summaries[0]?.type, "Manual");
  assert.equal(summaries[0]?.status, "Completed");
  assert.equal(summaries[0]?.startedAt, "2026-06-09T05:00:30Z");
  assert.equal(summaries[0]?.duration, "2m 30s");
  assert.equal(summaries[0]?.size, "10Gi");
  assert.equal(summaries[0]?.restorable, true);
  assert.equal(summaries[0]?.deletable, true);
  assert.deepEqual(summaries[0]?.source, source);

  assert.equal(summaries[1]?.type, "Automatic");
  assert.equal(summaries[1]?.failureReason, "volume snapshot failed");
  assert.equal(summaries[1]?.restorable, false);
  assert.equal(summaries[1]?.deletable, true);
});

test("marks active and deleting backups as not restorable or deletable", () => {
  const summaries = adaptDbServiceBackups({
    backups: [
      {
        metadata: {
          creationTimestamp: "2026-06-09T05:00:00Z",
          deletionTimestamp: "2026-06-09T05:02:00Z",
          name: "orders-deleting",
          namespace: "database-system",
        },
        status: { phase: "Completed" },
      },
      {
        metadata: {
          creationTimestamp: "2026-06-09T05:01:00Z",
          name: "orders-running",
          namespace: "database-system",
        },
        status: { phase: "Running" },
      },
    ],
    source,
  });

  assert.equal(summaries[0]?.status, "Running");
  assert.equal(summaries[0]?.restorable, false);
  assert.equal(summaries[0]?.deletable, false);
  assert.equal(summaries[1]?.status, "Deleting");
  assert.equal(summaries[1]?.restorable, false);
  assert.equal(summaries[1]?.deletable, false);
  assert.equal(dbServiceBackupNeedsRefresh(summaries), true);
});

test("detects supported DB Service backup engines", () => {
  assert.equal(isDbServiceBackupSupportedEngine("POSTGRES"), true);
  assert.equal(isDbServiceBackupSupportedEngine("MYSQL"), true);
  assert.equal(isDbServiceBackupSupportedEngine("MONGODB"), true);
  assert.equal(isDbServiceBackupSupportedEngine("REDIS"), true);
  assert.equal(isDbServiceBackupSupportedEngine("UNSUPPORTED"), false);
});
