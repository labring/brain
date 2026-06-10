import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessObjectRef } from "@data-browser/api/access-types";
import {
  createDbAccessSession,
  openDbAccessServiceTab,
  openDbAccessTab,
  setActiveDbAccessServiceTab,
} from "./session";

const tableRef = {
  kind: "table",
  path: ["orders", "public", "users"],
} satisfies AccessObjectRef;

test("new DB Access Sessions start on the DB Service Backup surface", () => {
  const session = createDbAccessSession("project/database-system/orders");

  assert.equal(session.activeSurface.kind, "service");
  assert.equal(session.activeSurface.tab, "backup");
  assert.equal(session.activeTabId, null);
  assert.deepEqual(session.tabs, []);
});

test("selecting DB Service root activates Backup without creating an object tab", () => {
  let session = createDbAccessSession("project/database-system/orders");
  session = openDbAccessTab(session, {
    databaseName: "orders",
    dbServiceKey: session.dbServiceKey,
    objectRef: tableRef,
    schemaName: "public",
    tableName: "users",
    title: "orders / users",
    type: "table",
  }).session;

  assert.equal(session.tabs.length, 1);
  assert.equal(session.activeSurface.kind, "object");

  session = openDbAccessServiceTab(session, "backup");

  assert.equal(session.activeSurface.kind, "service");
  assert.equal(session.activeSurface.tab, "backup");
  assert.equal(session.tabs.length, 1);
  assert.equal(session.activeTabId, null);
});

test("activating an object tab leaves the service Backup surface", () => {
  let session = createDbAccessSession("project/database-system/orders");
  session = setActiveDbAccessServiceTab(session, "backup");
  const result = openDbAccessTab(session, {
    databaseName: "orders",
    dbServiceKey: session.dbServiceKey,
    objectRef: tableRef,
    schemaName: "public",
    tableName: "users",
    title: "orders / users",
    type: "table",
  });

  assert.equal(result.session.activeSurface.kind, "object");
  assert.equal(result.session.activeTabId, result.tabId);
});
