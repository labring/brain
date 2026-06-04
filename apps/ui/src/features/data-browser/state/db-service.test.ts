import assert from "node:assert/strict";
import { test } from "node:test";

import type { DataBrowserHostContext } from "@data-browser/api/access-types";
import {
  dbAccessExpandedStorageKey,
  dbAccessSessionKeyFromRuntime,
} from "./db-service";

const runtime = {
  database: {
    displayEngine: "PostgreSQL",
    formattedVersion: "16.4",
    name: "orders-db",
  },
  databaseWorkloadName: "orders-db-claim",
  databaseWorkloadNamespace: "database-system",
  engine: "POSTGRES",
  kubeconfig: "kube",
  namespace: "project-ns",
  projectId: "project-uid",
} satisfies DataBrowserHostContext;

test("DB Service key is scoped by project ID and workload identity", () => {
  assert.equal(
    dbAccessSessionKeyFromRuntime(runtime),
    "project-uid:database-system:orders-db-claim"
  );
});

test("expanded tree storage key uses DB Service workload identity", () => {
  assert.equal(
    dbAccessExpandedStorageKey(runtime),
    "data-browser:expanded:project-uid:database-system:orders-db-claim"
  );
});
