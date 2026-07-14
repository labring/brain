import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  AccessObjectRef,
  DataBrowserHostContext,
} from "@db-browser/api/access-types";
import { createStore, useStore } from "jotai";
import { type ComponentType, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DbAccessSessionProvider,
  type DbAccessSessionProviderProps,
  useDbAccessTabs,
} from "./db-access-session";
import {
  createDbAccessViewStateRegistry,
  type DbAccessViewStateRegistry,
  useDbAccessViewStateRegistry,
} from "./db-access-view-state";
import { dbAccessObjectTabId } from "./session";

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

const usersRef = {
  kind: "table",
  path: ["orders", "public", "users"],
} satisfies AccessObjectRef;

const ServerTestSessionProvider = DbAccessSessionProvider as ComponentType<
  Omit<DbAccessSessionProviderProps, "children">
>;

test("DB Access Object Views isolate state and subscription notifications", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const users = registry.view("users");
  const invoices = registry.view("invoices");
  let usersPaginationNotifications = 0;
  let usersSortNotifications = 0;
  let invoicesPaginationNotifications = 0;

  const unsubscribeUsersPagination = store.sub(users.paginationAtom, () => {
    usersPaginationNotifications += 1;
  });
  const unsubscribeUsersSort = store.sub(users.sortAtom, () => {
    usersSortNotifications += 1;
  });
  const unsubscribeInvoicesPagination = store.sub(
    invoices.paginationAtom,
    () => {
      invoicesPaginationNotifications += 1;
    }
  );

  store.set(users.setCurrentPageAtom, 3);

  assert.deepEqual(store.get(users.paginationAtom), {
    currentPage: 3,
    pageSize: 50,
  });
  assert.deepEqual(store.get(invoices.paginationAtom), {
    currentPage: 1,
    pageSize: 50,
  });
  assert.equal(usersPaginationNotifications, 1);
  assert.equal(usersSortNotifications, 0);
  assert.equal(invoicesPaginationNotifications, 0);

  unsubscribeUsersPagination();
  unsubscribeUsersSort();
  unsubscribeInvoicesPagination();
});

test("view actions preserve pagination, sorting, and Find invariants", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const view = registry.view("users");

  store.set(view.setCurrentPageAtom, 4);
  store.set(view.setPageSizeAtom, 100);
  assert.deepEqual(store.get(view.paginationAtom), {
    currentPage: 1,
    pageSize: 100,
  });

  store.set(view.setSortAtom, { column: "email", direction: "desc" });
  assert.deepEqual(store.get(view.sortAtom), {
    column: "email",
    direction: "desc",
  });
  store.set(view.clearSortAtom);
  assert.deepEqual(store.get(view.sortAtom), {
    column: null,
    direction: null,
  });

  store.set(view.currentFindMatchAtom, 7);
  store.set(view.setFindTermAtom, "alice");
  assert.equal(store.get(view.findTermAtom), "alice");
  assert.equal(store.get(view.currentFindMatchAtom), 0);
});

test("column widths notify only subscribers for the changed column", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const view = registry.view("users");
  const idWidthAtom = view.columnWidthAtom("id");
  const nameWidthAtom = view.columnWidthAtom("name");
  let nameWidthNotifications = 0;

  const unsubscribe = store.sub(nameWidthAtom, () => {
    nameWidthNotifications += 1;
  });
  store.set(idWidthAtom, 160);

  assert.equal(store.get(idWidthAtom), 160);
  assert.equal(store.get(nameWidthAtom), null);
  assert.equal(nameWidthNotifications, 0);
  unsubscribe();
});

test("refresh invalidation targets only one Object View", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const users = registry.view("users");
  const invoices = registry.view("invoices");
  let invoiceRefreshNotifications = 0;

  const unsubscribe = store.sub(invoices.refreshVersionAtom, () => {
    invoiceRefreshNotifications += 1;
  });
  store.set(users.triggerRefreshAtom);

  assert.equal(store.get(users.refreshVersionAtom), 1);
  assert.equal(store.get(invoices.refreshVersionAtom), 0);
  assert.equal(invoiceRefreshNotifications, 0);
  unsubscribe();
});

test("looking up refresh state never creates a closed Object View", () => {
  const registry = createDbAccessViewStateRegistry();

  registry.view("closed");
  registry.disposeView("closed");
  assert.equal(registry.getView("closed"), undefined);
});

test("disposing an Object View resets it when reopened", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const firstView = registry.view("users");

  store.set(firstView.setCurrentPageAtom, 5);
  store.set(firstView.columnWidthAtom("email"), 240);
  registry.disposeView("users");

  const reopenedView = registry.view("users");
  assert.notEqual(reopenedView, firstView);
  assert.deepEqual(store.get(reopenedView.paginationAtom), {
    currentPage: 1,
    pageSize: 50,
  });
  assert.equal(store.get(reopenedView.columnWidthAtom("email")), null);
});

test("disposing a DB Access Session resets every Object View", () => {
  const registry = createDbAccessViewStateRegistry();
  const store = createStore();
  const users = registry.view("users");
  const invoices = registry.view("invoices");

  store.set(users.setCurrentPageAtom, 3);
  store.set(invoices.setFindTermAtom, "paid");
  registry.disposeAll();

  assert.deepEqual(store.get(registry.view("users").paginationAtom), {
    currentPage: 1,
    pageSize: 50,
  });
  assert.equal(store.get(registry.view("invoices").findTermAtom), "");
});

test("closing a tab through the session hook disposes its Object View", () => {
  let capture:
    | {
        registry: DbAccessViewStateRegistry;
        store: ReturnType<typeof createStore>;
        tabs: ReturnType<typeof useDbAccessTabs>;
      }
    | undefined;

  function CaptureSession() {
    capture = {
      registry: useDbAccessViewStateRegistry(),
      store: useStore(),
      tabs: useDbAccessTabs(),
    };
    return null;
  }

  const tabId = dbAccessObjectTabId(usersRef);
  renderToStaticMarkup(
    createElement(
      ServerTestSessionProvider,
      {
        initialSession: {
          activeSurface: { kind: "object", tabId },
          activeTabId: tabId,
          dbServiceKey: "project-uid:database-system:orders-db",
          tabs: [
            {
              databaseName: "orders",
              dbServiceKey: "project-uid:database-system:orders-db",
              id: tabId,
              objectRef: usersRef,
              schemaName: "public",
              tableName: "users",
              title: "orders.users",
              type: "table",
            },
          ],
        },
        runtime,
      },
      createElement(CaptureSession)
    )
  );

  assert.ok(capture);
  const firstView = capture.registry.view(tabId);
  capture.store.set(firstView.setCurrentPageAtom, 4);
  capture.tabs.closeTab(tabId);

  assert.equal(capture.registry.getView(tabId), undefined);
  const reopenedView = capture.registry.view(tabId);
  assert.notEqual(reopenedView, firstView);
  assert.deepEqual(capture.store.get(reopenedView.paginationAtom), {
    currentPage: 1,
    pageSize: 50,
  });
});

test("separate DB Access Sessions never share atom definitions", () => {
  const firstSession = createDbAccessViewStateRegistry();
  const secondSession = createDbAccessViewStateRegistry();

  assert.notEqual(
    firstSession.view("users").paginationAtom,
    secondSession.view("users").paginationAtom
  );
});
