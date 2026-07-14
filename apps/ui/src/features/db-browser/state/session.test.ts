import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessObjectRef } from "@db-browser/api/access-types";
import {
  createDbAccessSession,
  dbAccessObjectTabId,
  openDbAccessTab,
  switchDbAccessSession,
} from "./session";

const tableRef = {
  kind: "table",
  path: ["app", "public", "users"],
} satisfies AccessObjectRef;

test("object tabs dedupe and activate by canonical AccessObjectRef identity", () => {
  let session = createDbAccessSession("project/database-system/orders");

  const first = openDbAccessTab(session, {
    dbServiceKey: session.dbServiceKey,
    databaseName: "app",
    objectRef: tableRef,
    schemaName: "public",
    tableName: "users",
    title: "users",
    type: "table",
  });
  session = first.session;

  const second = openDbAccessTab(session, {
    dbServiceKey: session.dbServiceKey,
    databaseName: "app",
    objectRef: tableRef,
    schemaName: "public",
    tableName: "Users Display Name",
    title: "Users Display Name",
    type: "table",
  });

  assert.equal(first.tabId, dbAccessObjectTabId(tableRef));
  assert.equal(second.tabId, first.tabId);
  assert.equal(second.session.tabs.length, 1);
  assert.equal(second.session.activeTabId, first.tabId);
});

test("switching DB Service starts a fresh DB Access Session", () => {
  let session = createDbAccessSession("project/database-system/orders");

  session = openDbAccessTab(session, {
    dbServiceKey: session.dbServiceKey,
    databaseName: "app",
    objectRef: tableRef,
    schemaName: "public",
    tableName: "users",
    title: "users",
    type: "table",
  }).session;

  const sameSession = switchDbAccessSession(
    session,
    "project/database-system/orders"
  );
  const nextServiceSession = switchDbAccessSession(
    sameSession,
    "project/database-system/inventory"
  );

  assert.equal(sameSession.tabs.length, 1);
  assert.equal(
    nextServiceSession.dbServiceKey,
    "project/database-system/inventory"
  );
  assert.deepEqual(nextServiceSession.tabs, []);
  assert.equal(nextServiceSession.activeTabId, null);
});
