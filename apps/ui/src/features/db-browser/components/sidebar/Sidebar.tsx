import type { AccessObjectRef } from "@db-browser/api/access-types";
import { DATA_BROWSER_CAPABILITIES } from "@db-browser/capabilities";
import type { Alert } from "@db-browser/components/database/shared/types";
import { PointerContextMenu } from "@db-browser/components/shared/PointerContextMenu";
import {
  useDbAccessService,
  useDbAccessSystemObjectsReveal,
  useDbAccessTabs,
  useSelectDbAccessItem,
} from "@db-browser/state/db-access-session";
import { useTriggerDbAccessViewRefresh } from "@db-browser/state/db-access-view-state";
import { dbAccessObjectTabId } from "@db-browser/state/session";
import {
  type MouseEvent,
  useCallback,
  useMemo,
  useReducer,
  useState,
} from "react";
import {
  getCollectionMenuItems,
  getDatabaseMenuItems,
  getDbServiceMenuItems,
  getRedisKeyMenuItems,
  getRedisKeysFolderMenuItems,
  getSchemaMenuItems,
  getTableFolderMenuItems,
  getTableMenuItems,
  getViewFolderMenuItems,
  getViewMenuItems,
} from "./contextMenuItems";
import { SidebarModals } from "./SidebarModals";
import {
  SidebarTreeProvider,
  TreeNode,
  TreeNodeProvider,
  useSidebarTree,
  useSidebarTreeIsAnyLoading,
} from "./SidebarTree";
import type { TreeNodeData } from "./SidebarTree/types";
import { dbServiceToNode, EXPANDABLE_TYPES } from "./SidebarTree/types";

export type ModalState =
  | {
      type: "export_data";
      params: {
        dbServiceKey: string;
        databaseName: string;
        schema: string | null;
        tableName: string;
        objectRef: AccessObjectRef;
      };
    }
  | {
      type: "export_collection";
      params: {
        dbServiceKey: string;
        databaseName: string;
        collectionName: string;
        objectRef: AccessObjectRef;
      };
    }
  | {
      type: "export_redis_key";
      params: {
        dbServiceKey: string;
        databaseName: string;
        keyName: string;
        objectRef: AccessObjectRef;
      };
    };

type Action = { action: "open"; modal: ModalState } | { action: "close" };

function modalReducer(
  _state: ModalState | null,
  action: Action
): ModalState | null {
  if (action.action === "close") {
    return null;
  }
  return action.modal;
}

function SidebarInner() {
  const dbService = useDbAccessService();
  const selectItem = useSelectDbAccessItem();
  const triggerViewRefresh = useTriggerDbAccessViewRefresh();
  const { openTab, setActiveServiceTab } = useDbAccessTabs();

  const { fetchNodeChildren, isExpanded, refreshNode, toggleItem } =
    useSidebarTree();
  const isAnyTreeNodeLoading = useSidebarTreeIsAnyLoading();
  const { revealedDatabases, toggleSystemObjects } =
    useDbAccessSystemObjectsReveal();

  const [activeModal, dispatch] = useReducer(modalReducer, null);
  const [alert, setAlert] = useState<Alert | null>(null);

  const openModal = useCallback(
    (modal: ModalState) => dispatch({ action: "open", modal }),
    []
  );
  const closeModal = useCallback(() => dispatch({ action: "close" }), []);

  const showAlert = useCallback(
    (title: string, message: string, type: Alert["type"]) =>
      setAlert({ title, message, type }),
    []
  );
  const closeAlert = useCallback(() => setAlert(null), []);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNodeData;
  } | null>(null);

  const handleItemClick = useCallback(
    async (node: TreeNodeData) => {
      selectItem(node);

      if (EXPANDABLE_TYPES.has(node.type)) {
        try {
          await toggleItem(node);
        } catch (error) {
          if (node.type === "db_service") {
            showAlert(
              "DB Service failed",
              error instanceof Error
                ? error.message
                : "Failed to load DB Service.",
              "error"
            );
          }
        }
      }

      if (node.type === "db_service") {
        setActiveServiceTab("backup");
      } else if (
        (node.type === "table" || node.type === "view") &&
        node.metadata.objectRef
      ) {
        const tableTitle = node.metadata.database
          ? `${node.metadata.database} / ${node.name}`
          : node.name;
        openTab({
          databaseName: node.metadata.database,
          dbServiceKey: node.dbServiceKey,
          objectRef: node.metadata.objectRef,
          schemaName: node.metadata.schema,
          tableName: node.name,
          title: tableTitle,
          type: "table",
        });
      } else if (node.type === "collection" && node.metadata.objectRef) {
        const collectionTitle = node.metadata.database
          ? `${node.metadata.database} / ${node.name}`
          : node.name;
        openTab({
          collectionName: node.name,
          databaseName: node.metadata.database,
          dbServiceKey: node.dbServiceKey,
          objectRef: node.metadata.objectRef,
          title: collectionTitle,
          type: "collection",
        });
        triggerViewRefresh(dbAccessObjectTabId(node.metadata.objectRef));
      } else if (node.type === "redis_key" && node.metadata.objectRef) {
        const redisDatabase = node.metadata.database ?? "";
        openTab({
          databaseName: redisDatabase,
          dbServiceKey: node.dbServiceKey,
          objectRef: node.metadata.objectRef,
          tableName: node.name,
          title: `${redisDatabase} / ${node.name}`,
          type: "redis_key_detail",
        });
      }
    },
    [
      openTab,
      selectItem,
      setActiveServiceTab,
      showAlert,
      toggleItem,
      triggerViewRefresh,
    ]
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent, node: TreeNodeData) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({ node, x: event.clientX, y: event.clientY });
    },
    []
  );

  const handleContextMenuAction = useCallback(
    (action: string) => {
      if (!contextMenu) {
        return;
      }
      const { node } = contextMenu;

      switch (action) {
        case "export_data":
          if (
            DATA_BROWSER_CAPABILITIES.actions.singleObjectExport &&
            node.metadata.objectRef
          ) {
            openModal({
              params: {
                databaseName: node.metadata.database ?? "",
                dbServiceKey: node.dbServiceKey,
                objectRef: node.metadata.objectRef,
                schema: node.metadata.schema ?? null,
                tableName: node.name,
              },
              type: "export_data",
            });
          }
          break;
        case "export_collection":
          if (
            DATA_BROWSER_CAPABILITIES.actions.singleObjectExport &&
            node.metadata.objectRef
          ) {
            openModal({
              params: {
                collectionName: node.name,
                databaseName: node.metadata.database ?? "",
                dbServiceKey: node.dbServiceKey,
                objectRef: node.metadata.objectRef,
              },
              type: "export_collection",
            });
          }
          break;
        case "export_redis_key":
          if (
            DATA_BROWSER_CAPABILITIES.actions.singleObjectExport &&
            node.metadata.objectRef
          ) {
            openModal({
              params: {
                databaseName: node.metadata.database ?? "",
                dbServiceKey: node.dbServiceKey,
                keyName: node.name,
                objectRef: node.metadata.objectRef,
              },
              type: "export_redis_key",
            });
          }
          break;
        case "refresh":
          if (isExpanded(node.id)) {
            fetchNodeChildren(node);
          } else if (EXPANDABLE_TYPES.has(node.type)) {
            toggleItem(node);
          } else if (
            (node.type === "collection" ||
              node.type === "table" ||
              node.type === "view" ||
              node.type === "redis_key") &&
            node.metadata.objectRef
          ) {
            triggerViewRefresh(dbAccessObjectTabId(node.metadata.objectRef));
          }
          break;
        case "show_system_objects":
          if (node.type === "database" && node.metadata.database) {
            toggleSystemObjects(node.metadata.database);
          }
          break;
      }

      setContextMenu(null);
    },
    [
      contextMenu,
      fetchNodeChildren,
      isExpanded,
      openModal,
      toggleItem,
      toggleSystemObjects,
      triggerViewRefresh,
    ]
  );

  const contextMenuItems = (() => {
    if (!contextMenu) {
      return [];
    }

    const { node } = contextMenu;
    const callbacks = {
      onAction: handleContextMenuAction,
    };
    const dbServiceEngineType = dbService.engineType;

    switch (node.type) {
      case "db_service":
        return getDbServiceMenuItems(dbServiceEngineType, callbacks);
      case "database":
        return getDatabaseMenuItems(dbServiceEngineType, callbacks, {
          systemObjectsRevealed:
            node.metadata.database !== undefined &&
            revealedDatabases.has(node.metadata.database),
        });
      case "schema":
        return getSchemaMenuItems(callbacks);
      case "table_folder":
        return getTableFolderMenuItems(callbacks);
      case "view_folder":
        return getViewFolderMenuItems(callbacks);
      case "table":
        return getTableMenuItems(dbServiceEngineType, callbacks);
      case "view":
        return getViewMenuItems(callbacks);
      case "collection":
        return getCollectionMenuItems(callbacks);
      case "redis_keys_folder":
        return getRedisKeysFolderMenuItems(callbacks);
      case "redis_key":
        return getRedisKeyMenuItems(callbacks);
      default:
        return [];
    }
  })();
  const rootNode = useMemo(
    () => dbServiceToNode(dbService),
    [dbService.dbServiceKey, dbService.displayName]
  );
  const treeNodeContext = useMemo(
    () => ({
      dbServiceEngineType: dbService.engineType,
      onContextMenu: handleContextMenu,
      onItemClick: handleItemClick,
      onToggle: toggleItem,
    }),
    [dbService.engineType, handleContextMenu, handleItemClick, toggleItem]
  );

  return (
    <div
      className="flex h-full w-full flex-col border-sidebar-border border-r"
      data-qa-module="database"
      data-qa-object="sidebar"
      data-qa-state={isAnyTreeNodeLoading ? "loading" : "ready"}
      data-testid="database.sidebar"
    >
      <div
        className="flex-1 overflow-y-auto p-2 pt-4"
        data-qa-module="database"
        data-qa-object="db-service-tree"
        data-qa-state="ready"
        data-testid="database.sidebar.tree"
      >
        <TreeNodeProvider value={treeNodeContext}>
          <TreeNode depth={0} node={rootNode} />
        </TreeNodeProvider>
      </div>

      {contextMenu && (
        <PointerContextMenu
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}

      <SidebarModals
        activeModal={activeModal}
        alert={alert}
        closeAlert={closeAlert}
        closeModal={closeModal}
        refreshNode={refreshNode}
      />
    </div>
  );
}

export function Sidebar() {
  return (
    <SidebarTreeProvider>
      <SidebarInner />
    </SidebarTreeProvider>
  );
}
