import assert from "node:assert/strict";
import { test } from "node:test";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import {
  createDataBrowserHostContext,
  dataBrowserRuntimeParts,
} from "./runtime";

const databaseData = {
  backupPolicy: {
    cronExpression: "15 8 * * *",
    enabled: true,
    retentionPeriod: "7d",
  },
  connections: [],
  states: {
    displayEngine: "PostgreSQL",
    engineKey: "postgresql",
    formattedVersion: "16.4",
    name: "orders-db",
    status: { label: "Running", tone: "running" },
  },
  uid: "cluster-uid-1",
  workload: {
    name: "orders-db-claim",
    namespace: "database-system",
  },
} satisfies CanvasDatabaseNodeData;

test("DB Access runtime is derived from host project and selected database", () => {
  const refreshProjectCanvas = async () => undefined;
  const runtime = createDataBrowserHostContext({
    kubeconfig: " kube ",
    namespace: "project-ns",
    refreshProjectCanvas,
    projectId: "project-uid",
    selectedDatabaseData: databaseData,
  });

  assert.equal(runtime.projectId, "project-uid");
  assert.equal(runtime.kubeconfig, " kube ");
  assert.equal(runtime.namespace, "project-ns");
  assert.equal(runtime.refreshProjectCanvas, refreshProjectCanvas);
  assert.equal(runtime.databaseWorkloadName, "orders-db-claim");
  assert.equal(runtime.databaseWorkloadNamespace, "database-system");
  assert.deepEqual(runtime.dbService, {
    name: "orders-db-claim",
    namespace: "database-system",
    uid: "cluster-uid-1",
  });
  assert.equal(runtime.dbServicePhase, "Running");
  assert.deepEqual(runtime.backupPolicy, {
    cronExpression: "15 8 * * *",
    enabled: true,
    retentionPeriod: "7d",
  });
  assert.equal(runtime.database.name, "orders-db");
  assert.equal(runtime.database.displayEngine, "PostgreSQL");
  assert.equal(runtime.database.formattedVersion, "16.4");
  assert.equal(runtime.engine, "POSTGRES");
});

test("DB Access runtime parts are stable across equivalent database node snapshots", () => {
  const nextDatabaseData = {
    backupPolicy: { ...databaseData.backupPolicy },
    backups: [],
    connections: [],
    states: { ...databaseData.states },
    uid: databaseData.uid,
    workload: { ...databaseData.workload },
  } satisfies CanvasDatabaseNodeData;

  assert.deepEqual(
    dataBrowserRuntimeParts(nextDatabaseData),
    dataBrowserRuntimeParts(databaseData)
  );
});
