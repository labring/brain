import assert from "node:assert/strict";
import { test } from "node:test";
import { dbAccessRevealedSystemObjectsAtom } from "@db-browser/state/db-access-session";
import { createStore, Provider } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { TreeNode, TreeNodeProvider } from "./SidebarTree.Node";
import { sidebarTreeStateAtom } from "./sidebar-tree-state";
import type { TreeNodeData } from "./types";

const dbServiceKey = "project-uid:database-system:postgres-main";

const databaseNode: TreeNodeData = {
  dbServiceKey,
  id: "db-node",
  metadata: { database: "app", objectRef: { kind: "database", path: ["app"] } },
  name: "app",
  type: "database",
};

const userTableNode: TreeNodeData = {
  dbServiceKey,
  id: "user-table",
  metadata: {
    database: "app",
    objectRef: { kind: "table", path: ["app", "public", "users"] },
    schema: "public",
    table: "users",
  },
  name: "users",
  parentId: databaseNode.id,
  type: "table",
};

const systemTableNode: TreeNodeData = {
  dbServiceKey,
  id: "system-table",
  metadata: {
    database: "app",
    objectRef: { kind: "table", path: ["app", "public", "postgres_log"] },
    schema: "public",
    system: true,
    table: "postgres_log",
  },
  name: "postgres_log",
  parentId: databaseNode.id,
  type: "table",
};

function renderDatabaseSubtree(store: ReturnType<typeof createStore>) {
  return renderToStaticMarkup(
    <Provider store={store}>
      <TreeNodeProvider
        value={{
          dbServiceEngineType: "POSTGRES",
          onContextMenu: () => undefined,
          onItemClick: () => undefined,
          onToggle: () => undefined,
        }}
      >
        <TreeNode depth={1} node={databaseNode} />
      </TreeNodeProvider>
    </Provider>
  );
}

function storeWithLoadedChildren() {
  const store = createStore();
  store.set(sidebarTreeStateAtom, (previous) => ({
    ...previous,
    expandedItems: new Set([databaseNode.id]),
    treeData: { [databaseNode.id]: [userTableNode, systemTableNode] },
  }));
  return store;
}

test("system objects are absent from the default object list", () => {
  const html = renderDatabaseSubtree(storeWithLoadedChildren());

  assert.match(html, /users/);
  assert.doesNotMatch(html, /postgres_log/);
});

test("revealed system objects render inline with a muted system state", () => {
  const store = storeWithLoadedChildren();
  store.set(dbAccessRevealedSystemObjectsAtom, new Set(["app"]));

  const html = renderDatabaseSubtree(store);

  assert.match(html, /postgres_log/);
  assert.match(html, /data-qa-state="idle leaf system"/);
  assert.match(html, /text-muted-foreground/);
});

test("revealing one Logical Database leaves other databases' lists clean", () => {
  const store = storeWithLoadedChildren();
  store.set(dbAccessRevealedSystemObjectsAtom, new Set(["other"]));

  const html = renderDatabaseSubtree(store);

  assert.doesNotMatch(html, /postgres_log/);
});
