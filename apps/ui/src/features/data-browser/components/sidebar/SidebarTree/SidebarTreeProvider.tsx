import { listObjects } from "@data-browser/api/access-adapter";
import type {
  AccessObject,
  AccessObjectRef,
} from "@data-browser/api/access-types";
import { DATA_BROWSER_CAPABILITIES } from "@data-browser/capabilities";
import { useDbAccessService } from "@data-browser/state/db-access-session";
import { dbAccessExpandedStorageKey } from "@data-browser/state/db-service";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { NodeType, TreeNodeData } from "./types";
import { dbServiceToNode } from "./types";

interface SidebarTreeContextValue {
  collapseNode: (nodeId: string) => void;
  expandedItems: Set<string>;
  fetchNodeChildren: (node: TreeNodeData) => Promise<TreeNodeData[]>;
  isLoading: Record<string, boolean>;
  refreshNode: (node: TreeNodeData) => Promise<void>;
  toggleItem: (node: TreeNodeData) => Promise<void>;
  treeData: Record<string, TreeNodeData[]>;
}

const SidebarTreeContext = createContext<SidebarTreeContextValue | null>(null);

export function useSidebarTree(): SidebarTreeContextValue {
  const context = use(SidebarTreeContext);
  if (!context) {
    throw new Error("useSidebarTree must be used within SidebarTreeProvider");
  }
  return context;
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

  const storageKey = useMemo(
    () => scopedStorageKey(dbService.runtime),
    [dbService.runtime]
  );

  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [treeData, setTreeData] = useState<Record<string, TreeNodeData[]>>({});
  const [isLoading, setIsLoading] = useState<Record<string, boolean>>({});
  const [isRestoring, setIsRestoring] = useState(true);
  const restoredStorageKey = useRef<string | null>(null);

  useEffect(() => {
    if (
      !canPersistExpandedTreeState({
        isRestoring,
        restoredStorageKey: restoredStorageKey.current,
        storageKey,
      })
    ) {
      return;
    }

    localStorage.setItem(storageKey, JSON.stringify(Array.from(expandedItems)));
  }, [expandedItems, isRestoring, storageKey]);

  const buildChildren = useCallback(
    async (node: TreeNodeData): Promise<TreeNodeData[]> => {
      const runtime =
        node.dbServiceKey === dbService.dbServiceKey ? dbService.runtime : null;

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

      if (node.type === "database" && dbService.engineType === "REDIS") {
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
    [dbService]
  );

  const loadNodeChildren = useCallback(
    async (node: TreeNodeData) => {
      setIsLoading((previous) => ({ ...previous, [node.id]: true }));
      try {
        const childNodes = await buildChildren(node);
        setTreeData((previous) => ({ ...previous, [node.id]: childNodes }));
        return childNodes;
      } finally {
        setIsLoading((previous) => ({ ...previous, [node.id]: false }));
      }
    },
    [buildChildren]
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
      setExpandedItems(new Set(expandedIds));

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
      setExpandedItems(new Set(expandedIds));

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
    [loadNodeChildren]
  );

  const toggleItem = useCallback(
    async (node: TreeNodeData) => {
      const newExpanded = new Set(expandedItems);

      if (newExpanded.has(node.id)) {
        newExpanded.delete(node.id);
      } else {
        newExpanded.add(node.id);
        if (!treeData[node.id] || node.type !== "db_service") {
          await fetchNodeChildren(node);
        }
      }

      setExpandedItems(newExpanded);
    },
    [expandedItems, fetchNodeChildren, treeData]
  );

  const refreshNode = useCallback(
    async (node: TreeNodeData) => {
      setTreeData((previous) => {
        const next = { ...previous };
        const childrenForNode = previous[node.id];
        if (childrenForNode) {
          for (const child of childrenForNode) {
            delete next[child.id];
          }
        }
        delete next[node.id];
        return next;
      });

      if (expandedItems.has(node.id)) {
        const childNodes = await fetchNodeChildren(node);
        for (const child of childNodes) {
          if (expandedItems.has(child.id)) {
            await fetchNodeChildren(child);
          }
        }
      }
    },
    [expandedItems, fetchNodeChildren]
  );

  const collapseNode = useCallback((nodeId: string) => {
    setExpandedItems((previous) => {
      const next = new Set(previous);
      next.delete(nodeId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (restoredStorageKey.current === storageKey) {
      return;
    }

    const restoreState = async () => {
      setIsRestoring(true);
      setTreeData({});

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
        setExpandedItems(restoredExpandedIds);

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
        setIsRestoring(false);
      }
    };

    restoredStorageKey.current = storageKey;
    restoreState();
  }, [dbService, expandDefaultTree, loadNodeChildren, storageKey]);

  return (
    <SidebarTreeContext
      value={{
        collapseNode,
        expandedItems,
        fetchNodeChildren,
        isLoading,
        refreshNode,
        toggleItem,
        treeData,
      }}
    >
      {children}
    </SidebarTreeContext>
  );
}

export const dataBrowserExpandedStorageKey = scopedStorageKey;
export const dataBrowserObjectNodeId = objectNodeId;
export const dataBrowserCanPersistExpandedTreeState =
  canPersistExpandedTreeState;
