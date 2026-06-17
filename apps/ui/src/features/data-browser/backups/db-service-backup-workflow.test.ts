import assert from "node:assert/strict";
import { test } from "node:test";

import type { DataBrowserDBServiceBackupPolicy } from "@data-browser/api/access-types";
import {
  DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS,
  deriveDbServiceBackupWorkflowState,
  suggestedDbServiceBackupName,
  suggestedRestoredDbServiceName,
  validateDbServiceBackupForm,
  validateRestoredDbServiceName,
} from "./db-service-backup-workflow";

const source = {
  name: "orders-db",
  namespace: "database-system",
  uid: "cluster-uid-1",
};

test("DB Service backup active refresh interval is three seconds", () => {
  assert.equal(DB_SERVICE_BACKUP_ACTIVE_REFRESH_MS, 3000);
});

test("DB Service Backup workflow derives visible backups and policy from refreshed DB Service state", () => {
  const initialPolicy: DataBrowserDBServiceBackupPolicy = {
    cronExpression: "0 2 * * *",
    enabled: true,
    retentionPeriod: "7d",
  };

  const state = deriveDbServiceBackupWorkflowState({
    dbServicePhase: "Running",
    engine: "POSTGRES",
    initialBackups: [
      {
        metadata: {
          creationTimestamp: "2026-06-08T05:00:00Z",
          name: "orders-old",
          namespace: "database-system",
        },
        status: { phase: "Completed" },
      },
    ],
    initialPolicy,
    isRefreshing: false,
    productResource: {
      data: {
        metadata: { name: "orders-db" },
        spec: {
          backupPolicy: {
            cronExpression: "15 8 * * *",
            enabled: true,
            retentionPeriod: "14d",
          },
        },
        status: {
          backups: [
            {
              metadata: {
                creationTimestamp: "2026-06-10T05:00:00Z",
                name: "orders-running",
                namespace: "database-system",
              },
              status: {
                phase: "Running",
                startTimestamp: "2026-06-10T05:00:00Z",
              },
            },
            {
              metadata: {
                creationTimestamp: "2026-06-09T05:00:00Z",
                name: "orders-deleted",
                namespace: "database-system",
              },
              status: { phase: "Completed" },
            },
          ],
        },
      },
    },
    source,
    optimisticallyDeletedBackupNames: new Set(["orders-deleted"]),
  });

  assert.equal(state.status, "refreshing");
  assert.equal(state.supported, true);
  assert.equal(state.canCreateManualBackup, true);
  assert.equal(state.manualBackupDisabledReason, undefined);
  assert.equal(state.needsRefresh, true);
  assert.deepEqual(
    state.backups.map((backup) => backup.name),
    ["orders-running"]
  );
  assert.deepEqual(state.policy, {
    cronExpression: "15 8 * * *",
    enabled: true,
    retentionPeriod: "14d",
  });
});

test("DB Service Backup workflow disables manual backup outside Running state", () => {
  const state = deriveDbServiceBackupWorkflowState({
    dbServicePhase: "Creating",
    engine: "POSTGRES",
    initialBackups: [],
    isRefreshing: false,
    source,
  });

  assert.equal(state.status, "ready");
  assert.equal(state.canCreateManualBackup, false);
  assert.equal(
    state.manualBackupDisabledReason,
    "Manual backup creation requires the source DB Service to be Running. Current state: Creating."
  );
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

test("manual backup name suggestion uses the source DB Service and local timestamp", () => {
  const suggestedName = suggestedDbServiceBackupName(
    "Orders DB",
    new Date(2026, 5, 10, 2, 3, 4)
  );

  assert.equal(suggestedName, "orders-db-manual-20260610-020304");
  assert.deepEqual(
    validateDbServiceBackupForm({ backupName: suggestedName }),
    {}
  );
});

test("restored DB Service name validation matches Project namespace names", () => {
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
    validateRestoredDbServiceName("orders-db", ["orders-db", "analytics-db"]),
    "A DB Service with this name already exists."
  );
});

test("restored DB Service name suggestion avoids existing Project namespace names", () => {
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
