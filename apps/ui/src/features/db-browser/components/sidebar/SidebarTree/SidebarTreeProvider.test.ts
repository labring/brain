import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccessObject } from "@db-browser/api/access-types";
import { createStore } from "jotai";
import {
  dataBrowserCanPersistExpandedTreeState,
  dataBrowserExpandedStorageKey,
  dataBrowserObjectNodeId,
  dataBrowserObjectToTreeNode,
  dataBrowserPostgresSchemaFolders,
  dataBrowserRedisKeysFolder,
  dataBrowserShouldUseDefaultExpandedTree,
  dataBrowserVisibleTreeChildren,
} from "./SidebarTreeProvider";
import {
  sidebarTreeNodeChildrenAtom,
  sidebarTreeNodeExpandedAtom,
  sidebarTreeStateAtom,
} from "./sidebar-tree-state";
import { dbServiceToNode, type TreeNodeData } from "./types";

const dbServiceKey = "project-uid:database-system:postgres-main";

function object(
  kind: string,
  path: string[],
  name = path.at(-1) ?? kind
): AccessObject {
  return {
    hasChildren: true,
    kind,
    name,
    ref: { kind, path },
  };
}

test("DB Service root node uses db_service type", () => {
  const node = dbServiceToNode({
    databaseName: "app",
    dbServiceKey,
    displayName: "postgres-main",
    engineType: "POSTGRES",
    runtime: {
      database: { displayEngine: "PostgreSQL", name: "app" },
      databaseWorkloadName: "postgres-main",
      databaseWorkloadNamespace: "database-system",
      dbService: {
        name: "postgres-main",
        namespace: "database-system",
      },
      engine: "POSTGRES",
      kubeconfig: "kube",
      namespace: "project-ns",
      projectId: "project-uid",
    },
  });

  assert.equal(node.type, "db_service");
  assert.equal(node.id, dbServiceKey);
  assert.equal(node.dbServiceKey, dbServiceKey);
});

test("tree maps access object refs to DB Service scoped node types", () => {
  const cases = [
    [object("database", ["app"]), "database"],
    [object("schema", ["app", "public"]), "schema"],
    [object("table", ["app", "public", "users"]), "table"],
    [object("view", ["app", "public", "active_users"]), "view"],
    [object("collection", ["app", "events"]), "collection"],
    [object("key", ["app", "session:1"]), "redis_key"],
  ] as const;

  for (const [accessObject, type] of cases) {
    const node = dataBrowserObjectToTreeNode({
      dbServiceKey,
      object: accessObject,
      parentId: "parent",
    });

    assert.equal(node?.type, type);
    assert.equal(node?.dbServiceKey, dbServiceKey);
    assert.deepEqual(node?.metadata.objectRef, accessObject.ref);
    assert.equal(
      node?.id,
      dataBrowserObjectNodeId(dbServiceKey, accessObject.ref)
    );
  }
});

test("tree nodes carry the access object's system classification", () => {
  const systemNode = dataBrowserObjectToTreeNode({
    dbServiceKey,
    object: {
      ...object("table", ["app", "public", "postgres_log"]),
      system: true,
    },
    parentId: "parent",
  });
  const userNode = dataBrowserObjectToTreeNode({
    dbServiceKey,
    object: object("table", ["app", "public", "users"]),
    parentId: "parent",
  });

  assert.equal(systemNode?.metadata.system, true);
  assert.equal(userNode?.metadata.system, undefined);
});

test("system objects stay hidden until their own Logical Database is revealed", () => {
  const userTable = dataBrowserObjectToTreeNode({
    dbServiceKey,
    object: object("table", ["app", "public", "users"]),
    parentId: "parent",
  });
  const systemTable = dataBrowserObjectToTreeNode({
    dbServiceKey,
    object: {
      ...object("table", ["app", "public", "postgres_log"]),
      system: true,
    },
    parentId: "parent",
  });
  const otherDatabaseSystemTable = dataBrowserObjectToTreeNode({
    dbServiceKey,
    object: {
      ...object("table", ["other", "public", "postgres_log"]),
      system: true,
    },
    parentId: "other-parent",
  });
  const children = [userTable, systemTable, otherDatabaseSystemTable].filter(
    (node): node is NonNullable<typeof node> => node !== null
  );

  assert.deepEqual(dataBrowserVisibleTreeChildren(children, new Set()), [
    userTable,
  ]);
  assert.deepEqual(dataBrowserVisibleTreeChildren(children, new Set(["app"])), [
    userTable,
    systemTable,
  ]);
  assert.deepEqual(
    dataBrowserVisibleTreeChildren(children, new Set(["app", "other"])),
    children
  );
});

test("postgres schema children are Tables and Views virtual folders", () => {
  const schemaRef = { kind: "schema", path: ["app", "public"] };
  const schemaNode: TreeNodeData = {
    dbServiceKey,
    id: "schema-node",
    metadata: {
      database: "app",
      objectRef: schemaRef,
      schema: "public",
    },
    name: "public",
    parentId: "db-node",
    type: "schema",
  };

  const folders = dataBrowserPostgresSchemaFolders(schemaNode);

  assert.deepEqual(
    folders.map((folder) => folder.type),
    ["table_folder", "view_folder"]
  );
  assert.deepEqual(
    folders.map((folder) => folder.metadata.kindFilter),
    [["table"], ["view"]]
  );
  assert.deepEqual(
    folders.map((folder) => folder.metadata.parentRef),
    [schemaRef, schemaRef]
  );
  assert.deepEqual(
    folders.map((folder) => folder.dbServiceKey),
    [dbServiceKey, dbServiceKey]
  );
});

test("redis database child is Keys virtual folder", () => {
  const databaseRef = { kind: "database", path: ["redis"] };
  const databaseNode: TreeNodeData = {
    dbServiceKey,
    id: "redis-db",
    metadata: {
      database: "redis",
      objectRef: databaseRef,
    },
    name: "redis",
    type: "database",
  };

  const folders = dataBrowserRedisKeysFolder(databaseNode);

  assert.equal(folders.length, 1);
  assert.equal(folders[0]?.type, "redis_keys_folder");
  assert.equal(folders[0]?.dbServiceKey, dbServiceKey);
  assert.deepEqual(folders[0]?.metadata.kindFilter, ["key"]);
  assert.deepEqual(folders[0]?.metadata.parentRef, databaseRef);
});

test("expanded tree localStorage key is scoped by project and service", () => {
  assert.equal(
    dataBrowserExpandedStorageKey({
      databaseWorkloadName: "postgres-main",
      databaseWorkloadNamespace: "database-system",
      projectId: "project-uid",
    }),
    "data-browser:expanded:project-uid:database-system:postgres-main"
  );
});

test("expanded tree state waits for the current DB Service key to restore before persisting", () => {
  assert.equal(
    dataBrowserCanPersistExpandedTreeState({
      isRestoring: false,
      restoredStorageKey:
        "data-browser:expanded:project-uid:database-system:postgres-main",
      storageKey:
        "data-browser:expanded:project-uid:database-system:mysql-main",
    }),
    false
  );
  assert.equal(
    dataBrowserCanPersistExpandedTreeState({
      isRestoring: true,
      restoredStorageKey:
        "data-browser:expanded:project-uid:database-system:mysql-main",
      storageKey:
        "data-browser:expanded:project-uid:database-system:mysql-main",
    }),
    false
  );
  assert.equal(
    dataBrowserCanPersistExpandedTreeState({
      isRestoring: false,
      restoredStorageKey:
        "data-browser:expanded:project-uid:database-system:mysql-main",
      storageKey:
        "data-browser:expanded:project-uid:database-system:mysql-main",
    }),
    true
  );
});

test("default expanded tree is used only for missing or old empty state", () => {
  assert.equal(dataBrowserShouldUseDefaultExpandedTree(null), true);
  assert.equal(dataBrowserShouldUseDefaultExpandedTree(new Set()), true);
  assert.equal(
    dataBrowserShouldUseDefaultExpandedTree(new Set([dbServiceKey])),
    false
  );
});

test("per-node tree selectors ignore updates to unrelated branches", () => {
  const store = createStore();
  const nodeAExpandedAtom = sidebarTreeNodeExpandedAtom("node-a");
  const nodeAChildrenAtom = sidebarTreeNodeChildrenAtom("node-a");
  let expandedNotifications = 0;
  let childrenNotifications = 0;
  const unsubscribeExpanded = store.sub(nodeAExpandedAtom, () => {
    expandedNotifications += 1;
  });
  const unsubscribeChildren = store.sub(nodeAChildrenAtom, () => {
    childrenNotifications += 1;
  });

  store.set(sidebarTreeStateAtom, (previous) => ({
    ...previous,
    expandedItems: new Set(["node-b"]),
    treeData: { "node-b": [] },
  }));
  assert.equal(expandedNotifications, 0);
  assert.equal(childrenNotifications, 0);

  const nodeAChildren: TreeNodeData[] = [];
  store.set(sidebarTreeStateAtom, (previous) => ({
    ...previous,
    expandedItems: new Set([...previous.expandedItems, "node-a"]),
    treeData: { ...previous.treeData, "node-a": nodeAChildren },
  }));
  assert.equal(expandedNotifications, 1);
  assert.equal(childrenNotifications, 1);
  assert.equal(store.get(nodeAExpandedAtom), true);
  assert.equal(store.get(nodeAChildrenAtom), nodeAChildren);

  unsubscribeExpanded();
  unsubscribeChildren();
});
