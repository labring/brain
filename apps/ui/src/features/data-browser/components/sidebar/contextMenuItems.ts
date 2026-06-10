import { DATA_BROWSER_CAPABILITIES } from "@data-browser/capabilities";
import type { PointerContextMenuItem } from "@data-browser/components/shared/PointerContextMenu";
import { Download, RefreshCw } from "lucide-react";
import React from "react";

type DbServiceEngineType =
  | "MYSQL"
  | "POSTGRES"
  | "MONGODB"
  | "REDIS"
  | "CLICKHOUSE";

interface MenuCallbacks {
  onAction: (action: string) => void;
}

interface SystemObjectsState {
  showSystemObjects: boolean;
  systemSchemas: string[];
}

function refreshItem(
  onAction: (action: string) => void
): PointerContextMenuItem {
  return {
    icon: React.createElement(RefreshCw, { className: "h-4 w-4" }),
    label: "Refresh",
    onClick: () => onAction("refresh"),
  };
}

function exportItem(
  action: string,
  onAction: (action: string) => void,
  label: string
): PointerContextMenuItem[] {
  if (!DATA_BROWSER_CAPABILITIES.actions.singleObjectExport) {
    return [];
  }

  return [
    {
      icon: React.createElement(Download, { className: "h-4 w-4" }),
      label,
      onClick: () => onAction(action),
    },
    { separator: true },
  ];
}

export function getDbServiceMenuItems(
  _dbServiceEngineType: DbServiceEngineType,
  callbacks: MenuCallbacks,
  _systemObjectsState?: SystemObjectsState
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getDatabaseMenuItems(
  _dbServiceEngineType: DbServiceEngineType,
  callbacks: MenuCallbacks,
  _systemObjectsState?: SystemObjectsState
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getSchemaMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getTableFolderMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getViewFolderMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getTableMenuItems(
  _dbServiceEngineType: DbServiceEngineType,
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [
    ...exportItem("export_data", onAction, "Export data"),
    refreshItem(onAction),
  ];
}

export function getViewMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [
    ...exportItem("export_data", onAction, "Export data"),
    refreshItem(onAction),
  ];
}

export function getCollectionMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [
    ...exportItem("export_collection", onAction, "Export collection"),
    refreshItem(onAction),
  ];
}

export function getRedisKeysFolderMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [refreshItem(onAction)];
}

export function getRedisKeyMenuItems(
  callbacks: MenuCallbacks
): PointerContextMenuItem[] {
  const { onAction } = callbacks;
  return [
    ...exportItem("export_redis_key", onAction, "Export key"),
    refreshItem(onAction),
  ];
}
