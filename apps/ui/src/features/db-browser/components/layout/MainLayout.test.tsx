import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AccessObjectRef,
  DataBrowserHostContext,
} from "@db-browser/api/access-types";
import { DbAccessSessionProvider } from "@db-browser/state/db-access-session";
import { dbAccessObjectTabId } from "@db-browser/state/session";
import { renderToStaticMarkup } from "react-dom/server";
import { MainLayout, sidebarWidthDuringResize } from "./MainLayout";

const tableRef = {
  kind: "table",
  path: ["orders", "public", "users"],
} satisfies AccessObjectRef;

const runtime = {
  database: {
    displayEngine: "PostgreSQL",
    formattedVersion: "16.4",
    name: "orders",
  },
  dbService: {
    name: "orders-db",
    namespace: "database-system",
  },
  databaseWorkloadName: "orders-db",
  databaseWorkloadNamespace: "database-system",
  engine: "POSTGRES",
  kubeconfig: "kube",
  namespace: "project-ns",
  projectId: "project-uid",
} satisfies DataBrowserHostContext;

test("layout provides tooltip context for tab controls", () => {
  let html = "";
  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(
      <DbAccessSessionProvider
        initialSession={{
          activeSurface: {
            kind: "object",
            tabId: dbAccessObjectTabId(tableRef),
          },
          activeTabId: dbAccessObjectTabId(tableRef),
          dbServiceKey: "project-uid:database-system:orders-db",
          tabs: [
            {
              databaseName: "orders",
              dbServiceKey: "project-uid:database-system:orders-db",
              id: dbAccessObjectTabId(tableRef),
              objectRef: tableRef,
              schemaName: "public",
              tableName: "users",
              title: "orders.users",
              type: "table",
            },
          ],
        }}
        runtime={runtime}
      >
        <MainLayout />
      </DbAccessSessionProvider>
    );
  });
  assert.match(html, /data-testid="layout\.tab\.close-button"/);
});

test("sidebar resize is relative to its starting width and stays bounded", () => {
  const origin = { startWidth: 256, startX: 400 };
  assert.equal(sidebarWidthDuringResize(origin, 440), 296);
  assert.equal(sidebarWidthDuringResize(origin, 0), 180);
  assert.equal(sidebarWidthDuringResize(origin, 1000), 480);
});
