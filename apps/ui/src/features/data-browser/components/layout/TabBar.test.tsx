import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AccessObjectRef,
  DataBrowserHostContext,
} from "@data-browser/api/access-types";
import { DbAccessSessionProvider } from "@data-browser/state/db-access-session";
import { dbAccessObjectTabId } from "@data-browser/state/session";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { renderToStaticMarkup } from "react-dom/server";
import { TabBar } from "./TabBar";

const usersRef = {
  kind: "table",
  path: ["orders", "public", "users"],
} satisfies AccessObjectRef;

const invoicesRef = {
  kind: "table",
  path: ["orders", "public", "invoices"],
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

const dbServiceKey = "project-uid:database-system:orders-db";

function tableTab(ref: AccessObjectRef, tableName: string, title: string) {
  return {
    databaseName: "orders",
    dbServiceKey,
    id: dbAccessObjectTabId(ref),
    objectRef: ref,
    schemaName: "public",
    tableName,
    title,
    type: "table" as const,
  };
}

function renderTabBar(activeRef: AccessObjectRef) {
  return renderToStaticMarkup(
    <DbAccessSessionProvider
      initialSession={{
        activeSurface: {
          kind: "object",
          tabId: dbAccessObjectTabId(activeRef),
        },
        activeTabId: dbAccessObjectTabId(activeRef),
        dbServiceKey,
        tabs: [
          tableTab(usersRef, "users", "orders.users"),
          tableTab(invoicesRef, "invoices", "orders.invoices"),
        ],
      }}
      runtime={runtime}
    >
      <TooltipProvider>
        <TabBar />
      </TooltipProvider>
    </DbAccessSessionProvider>
  );
}

test("renders one tab item per open tab inside the scroll strip", () => {
  const html = renderTabBar(usersRef);
  const tabItems = html.match(/data-testid="layout\.tab\.item"/g) ?? [];
  assert.equal(tabItems.length, 2);
  assert.match(html, /orders\.users/);
  assert.match(html, /orders\.invoices/);
  assert.match(html, /data-slot="scroll-area-viewport"/);
});

test("marks only the active tab as active", () => {
  const html = renderTabBar(invoicesRef);
  const activeStates = html.match(/data-qa-state="active"/g) ?? [];
  assert.equal(activeStates.length, 1);
  assert.match(html, /data-qa-state="inactive"/);
});

test("hides the overflow trigger until overflow is measured", () => {
  const html = renderTabBar(usersRef);
  assert.doesNotMatch(html, /layout\.tab-bar\.overflow-trigger/);
  assert.match(html, /data-qa-state="ready"/);
  assert.doesNotMatch(html, /overflowing/);
});
