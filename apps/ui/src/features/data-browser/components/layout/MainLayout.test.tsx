import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AccessObjectRef,
  DataBrowserHostContext,
} from "@data-browser/api/access-types";
import { DbAccessSessionProvider } from "@data-browser/state/db-access-session";
import { dbAccessObjectTabId } from "@data-browser/state/session";
import { renderToStaticMarkup } from "react-dom/server";
import { MainLayout } from "./MainLayout";

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
