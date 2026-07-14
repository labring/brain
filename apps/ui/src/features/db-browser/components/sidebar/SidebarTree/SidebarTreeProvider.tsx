import { listObjects } from "@db-browser/api/access-adapter";
import type {
  AccessObject,
  AccessObjectRef,
} from "@db-browser/api/access-types";
import { DATA_BROWSER_CAPABILITIES } from "@db-browser/capabilities";
import { useDbAccessService } from "@db-browser/state/db-access-session";
import { dbAccessExpandedStorageKey } from "@db-browser/state/db-service";
import { useAtomValue, useStore } from "jotai";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  sidebarTreeAnyLoadingAtom,
  sidebarTreeNodeChildrenAtom,
  sidebarTreeNodeExpandedAtom,
  sidebarTreeNodeLoadingAtom,
  sidebarTreeStateAtom,
} from "./sidebar-tree-state";
import type { NodeType, TreeNodeData } from "./types";
import { dbServiceToNode } from "./types";

interface SidebarTreeContextValue {
  collapseNode: (nodeId: string) => void;
  fetchNodeChildren: (node: TreeNodeData) => Promise<TreeNodeData[]>;
  isExpanded: (nodeId: string) => boolean;
  refreshNode: (node: TreeNodeData) => Promise<void>;
  toggleItem: (node: TreeNodeData) => Promise<void>;
}

const SidebarTreeContext = createContext<SidebarTreeContextValue | null>(null);

export function useSidebarTree(): SidebarTreeContextValue {
  const context = use(SidebarTreeContext);
  if (!context) {
    throw new Error("useSidebarTree must be used within SidebarTreeProvider");
  }
  return context;
}

export function useSidebarTreeIsAnyLoading() {
  return useAtomValue(sidebarTreeAnyLoadingAtom);
}

export function useSidebarTreeNodeState(nodeId: string) {
  const childrenAtom = useMemo(
    () => sidebarTreeNodeChildrenAtom(nodeId),
    [nodeId]
  );
  const expandedAtom = useMemo(
    () => sidebarTreeNodeExpandedAtom(nodeId),
    [nodeId]
  );
  const loadingAtom = useMemo(
    () => sidebarTreeNodeLoadingAtom(nodeId),
    [nodeId]
  );

  return {
    children: useAtomValue(childrenAtom),
    isExpanded: useAtomValue(expandedAtom),
    isLoading: useAtomValue(loadingAtom),
  };
}

function scopedStorageKey(
  runtime: Parameters<typeof dbAccessExpandedStorageKey>[0]
) {
  return dbAccessExpandedStorageKey(runtime);
}

function canPersistExpandedTreeState({
  isRestoring,
  restoredStorageKey,
  storageKey,
}: {
  isRestoring: boolean;
  restoredStorageKey: string | null;
  storageKey: string;
}) {
  return !isRestoring && restoredStorageKey === storageKey;
}

function nodeTypeForObject(object: AccessObject): NodeType | null {
  if (!DATA_BROWSER_CAPABILITIES.visibleObjectKinds.has(object.kind)) {
    return null;
  }

  if (object.kind === "key") {
    return "redis_key";
  }

  if (
    object.kind === "database" ||
    object.kind === "schema" ||
    object.kind === "table" ||
    object.kind === "view" ||
    object.kind === "collection"
  ) {
    return object.kind;
  }

  return null;
}

function objectNodeId(dbServiceKey: string, ref: AccessObjectRef): string {
  return `${dbServiceKey}:${ref.kind}:${JSON.stringify(ref.path)}`;
}

function objectToNode({
  dbServiceKey,
  object,
  parentId,
}: {
  dbServiceKey: string;
  object: AccessObject;
  parentId: string;
}): TreeNodeData | null {
  const type = nodeTypeForObject(object);
  if (type === null) {
    return null;
  }

  const [database, schema] = object.ref.path;
  const name =
    object.displayName || object.name || object.ref.path.at(-1) || object.kind;

  return {
    dbServiceKey,
    id: objectNodeId(dbServiceKey, object.ref),
    metadata: {
      database,
      objectRef: object.ref,
      redisKeyType: object.metadata?.type,
      schema,
      table:
        type === "table" || type === "view" || type === "collection"
          ? name
          : undefined,
    },
    name,
    parentId,
    type,
  };
}

export function dataBrowserObjectToTreeNode(params: {
  dbServiceKey: string;
  object: AccessObject;
  parentId: string;
}): TreeNodeData | null {
  return objectToNode(params);
}

export function dataBrowserPostgresSchemaFolders(
  node: TreeNodeData
): TreeNodeData[] {
  const ref = node.metadata.objectRef;
  if (!ref) {
    return [];
  }

  return [
    {
      dbServiceKey: node.dbServiceKey,
      id: `${node.id}:tables`,
      metadata: {
        database: node.metadata.database,
        kindFilter: ["table"],
        parentRef: ref,
        schema: node.name,
      },
      name: "Tables",
      parentId: node.id,
      type: "table_folder",
    },
    {
      dbServiceKey: node.dbServiceKey,
      id: `${node.id}:views`,
      metadata: {
        database: node.metadata.database,
        kindFilter: ["view"],
        parentRef: ref,
        schema: node.name,
      },
      name: "Views",
      parentId: node.id,
      type: "view_folder",
    },
  ];
}

export function dataBrowserRedisKeysFolder(node: TreeNodeData): TreeNodeData[] {
  const ref = node.metadata.objectRef;
  if (!ref) {
    return [];
  }

  return [
    {
      dbServiceKey: node.dbServiceKey,
      id: `${node.id}:keys`,
      metadata: {
        database: node.name,
        kindFilter: ["key"],
        parentRef: ref,
      },
      name: "Keys",
      parentId: node.id,
      type: "redis_keys_folder",
    },
  ];
}

function compactNodes(nodes: Array<TreeNodeData | null>): TreeNodeData[] {
  return nodes.filter((node): node is TreeNodeData => node !== null);
}

function expandedIdsFromStorageValue(
  stored: string | null
): Set<string> | null {
  if (stored === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(stored);
  if (!Array.isArray(parsed)) {
    return null;
  }

  return new Set(
    parsed.filter((item): item is string => typeof item === "string")
  );
}

export function dataBrowserShouldUseDefaultExpandedTree(
  expandedIds: ReadonlySet<string> | null
): boolean {
  return expandedIds === null || expandedIds.size === 0;
}

export function SidebarTreeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const dbService = useDbAccessService();
  const { dbServiceKey, engineType, runtime } = dbService;

  const storageKey = useMemo(() => scopedStorageKey(runtime), [runtime]);
  const store = useStore();
  const restoredStorageKey = useRef<string | null>(null);

  useEffect(() => {
    let lastPersistedValue = localStorage.getItem(storageKey);
    const persistExpandedItems = () => {
      const state = store.get(sidebarTreeStateAtom);
      if (
        !canPersistExpandedTreeState({
          isRestoring: state.isRestoring,
          restoredStorageKey: restoredStorageKey.current,
          storageKey,
        })
      ) {
        return;
      }

      const nextValue = JSON.stringify(Array.from(state.expandedItems));
      if (nextValue !== lastPersistedValue) {
        localStorage.setItem(storageKey, nextValue);
        lastPersistedValue = nextValue;
      }
    };

    persistExpandedItems();
    return store.sub(sidebarTreeStateAtom, persistExpandedItems);
  }, [storageKey, store]);

  const buildChildren = useCallback(
    async (node: TreeNodeData): Promise<TreeNodeData[]> => {
      const runtime =
        node.dbServiceKey === dbServiceKey ? dbService.runtime : null;

      if (!runtime) {
        return [];
      }

      if (node.type === "db_service") {
        const result = await listObjects({ runtime });
        return compactNodes(
          result.objects.map((object) =>
            objectToNode({
              dbServiceKey: node.dbServiceKey,
              object,
              parentId: node.id,
            })
          )
        );
      }

      if (node.type === "schema") {
        return dataBrowserPostgresSchemaFolders(node);
      }

      if (node.type === "database" && engineType === "REDIS") {
        return dataBrowserRedisKeysFolder(node);
      }

      if (
        node.type === "table_folder" ||
        node.type === "view_folder" ||
        node.type === "redis_keys_folder"
      ) {
        const parent = node.metadata.parentRef;
        if (!parent) {
          return [];
        }

        const result = await listObjects({
          kinds: node.metadata.kindFilter,
          parent,
          runtime,
        });
        return compactNodes(
          result.objects.map((object) =>
            objectToNode({
              dbServiceKey: node.dbServiceKey,
              object,
              parentId: node.id,
            })
          )
        );
      }

      if (node.type === "database") {
        const parent = node.metadata.objectRef;
        if (!parent) {
          return [];
        }

        const result = await listObjects({ parent, runtime });
        return compactNodes(
          result.objects.map((object) =>
            objectToNode({
              dbServiceKey: node.dbServiceKey,
              object,
              parentId: node.id,
            })
          )
        );
      }

      return [];
    },
    [dbService.runtime, dbServiceKey, engineType]
  );

  const loadNodeChildren = useCallback(
    async (node: TreeNodeData) => {
      store.set(sidebarTreeStateAtom, (previous) => ({
        ...previous,
        isLoading: { ...previous.isLoading, [node.id]: true },
      }));
      try {
        const childNodes = await buildChildren(node);
        store.set(sidebarTreeStateAtom, (previous) => ({
          ...previous,
          treeData: { ...previous.treeData, [node.id]: childNodes },
        }));
        return childNodes;
      } finally {
        store.set(sidebarTreeStateAtom, (previous) => ({
          ...previous,
          isLoading: { ...previous.isLoading, [node.id]: false },
        }));
      }
    },
    [buildChildren, store]
  );

  const fetchNodeChildren = useCallback(
    async (node: TreeNodeData) => {
      try {
        return await loadNodeChildren(node);
      } catch (error) {
        console.error("Failed to fetch children:", error);
        throw error;
      }
    },
    [loadNodeChildren]
  );

  const expandDefaultTree = useCallback(
    async (rootNode: TreeNodeData) => {
      const expandedIds = new Set<string>([rootNode.id]);
      store.set(sidebarTreeStateAtom, (previous) => ({
        ...previous,
        expandedItems: new Set(expandedIds),
      }));

      let rootChildren: TreeNodeData[] = [];
      try {
        rootChildren = await loadNodeChildren(rootNode);
      } catch (error) {
        console.error(
          "Failed to initialize default expanded DB Access tree:",
          error
        );
        return;
      }

      const logicalDatabases = rootChildren.filter(
        (child) => child.type === "database"
      );
      for (const databaseNode of logicalDatabases) {
        expandedIds.add(databaseNode.id);
      }
      store.set(sidebarTreeStateAtom, (previous) => ({
        ...previous,
        expandedItems: new Set(expandedIds),
      }));

      for (const databaseNode of logicalDatabases) {
        try {
          await loadNodeChildren(databaseNode);
        } catch (error) {
          console.error(
            "Failed to initialize default expanded DB Access node:",
            databaseNode.id,
            error
          );
        }
      }
    },
    [loadNodeChildren, store]
  );

  const toggleItem = useCallback(
    async (node: TreeNodeData) => {
      const state = store.get(sidebarTreeStateAtom);

      if (state.expandedItems.has(node.id)) {
        store.set(sidebarTreeStateAtom, (previous) => {
          const expandedItems = new Set(previous.expandedItems);
          expandedItems.delete(node.id);
          return { ...previous, expandedItems };
        });
      } else {
        if (!state.treeData[node.id] || node.type !== "db_service") {
          await fetchNodeChildren(node);
        }
        store.set(sidebarTreeStateAtom, (previous) => ({
          ...previous,
          expandedItems: new Set([...previous.expandedItems, node.id]),
        }));
      }
    },
    [fetchNodeChildren, store]
  );

  const refreshNode = useCallback(
    async (node: TreeNodeData) => {
      store.set(sidebarTreeStateAtom, (previous) => {
        const nextTreeData = { ...previous.treeData };
        const childrenForNode = previous.treeData[node.id];
        if (childrenForNode) {
          for (const child of childrenForNode) {
            delete nextTreeData[child.id];
          }
        }
        delete nextTreeData[node.id];
        return { ...previous, treeData: nextTreeData };
      });

      if (store.get(sidebarTreeStateAtom).expandedItems.has(node.id)) {
        const childNodes = await fetchNodeChildren(node);
        for (const child of childNodes) {
          if (store.get(sidebarTreeStateAtom).expandedItems.has(child.id)) {
            await fetchNodeChildren(child);
          }
        }
      }
    },
    [fetchNodeChildren, store]
  );

  const collapseNode = useCallback(
    (nodeId: string) => {
      store.set(sidebarTreeStateAtom, (previous) => {
        const expandedItems = new Set(previous.expandedItems);
        expandedItems.delete(nodeId);
        return { ...previous, expandedItems };
      });
    },
    [store]
  );

  const isExpanded = useCallback(
    (nodeId: string) =>
      store.get(sidebarTreeStateAtom).expandedItems.has(nodeId),
    [store]
  );

  useEffect(() => {
    if (restoredStorageKey.current === storageKey) {
      return;
    }

    const restoreState = async () => {
      store.set(sidebarTreeStateAtom, (previous) => ({
        ...previous,
        isRestoring: true,
        treeData: {},
      }));

      const stored = localStorage.getItem(storageKey);
      try {
        let expandedIds: Set<string> | null = null;
        try {
          expandedIds = expandedIdsFromStorageValue(stored);
        } catch (error) {
          console.error("Failed to parse expanded items", error);
        }

        const rootNode = dbServiceToNode(dbService);
        if (
          expandedIds === null ||
          dataBrowserShouldUseDefaultExpandedTree(expandedIds)
        ) {
          await expandDefaultTree(rootNode);
          return;
        }

        const restoredExpandedIds = expandedIds;
        store.set(sidebarTreeStateAtom, (previous) => ({
          ...previous,
          expandedItems: restoredExpandedIds,
        }));

        const fetchRecursively = async (nodes: TreeNodeData[]) => {
          for (const node of nodes) {
            if (!restoredExpandedIds.has(node.id)) {
              continue;
            }
            try {
              const childNodes = await loadNodeChildren(node);
              if (childNodes.length > 0) {
                await fetchRecursively(childNodes);
              }
            } catch (error) {
              console.error("Failed to restore node:", node.id, error);
            }
          }
        };

        await fetchRecursively([rootNode]);
      } catch (error) {
        console.error("Failed to restore expanded items", error);
      } finally {
        store.set(sidebarTreeStateAtom, (previous) => ({
          ...previous,
          isRestoring: false,
        }));
      }
    };

    restoredStorageKey.current = storageKey;
    restoreState();
  }, [dbService, expandDefaultTree, loadNodeChildren, storageKey, store]);

  const contextValue = useMemo(
    () => ({
      collapseNode,
      fetchNodeChildren,
      isExpanded,
      refreshNode,
      toggleItem,
    }),
    [collapseNode, fetchNodeChildren, isExpanded, refreshNode, toggleItem]
  );

  return (
    <SidebarTreeContext value={contextValue}>{children}</SidebarTreeContext>
  );
}

export const dataBrowserExpandedStorageKey = scopedStorageKey;
export const dataBrowserObjectNodeId = objectNodeId;
export const dataBrowserCanPersistExpandedTreeState =
  canPersistExpandedTreeState;
