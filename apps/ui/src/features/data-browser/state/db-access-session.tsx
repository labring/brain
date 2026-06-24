"use client";

import type { DataBrowserHostContext } from "@data-browser/api/access-types";
import type { DataBrowserEngine } from "@data-browser/api/engine";
import { atom, createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
} from "react";
import { dbAccessSessionKeyFromRuntime } from "./db-service";
import {
  closeAllDbAccessTabs,
  closeDbAccessTab,
  closeOtherDbAccessTabs,
  createDbAccessSession,
  type DbAccessServiceTab,
  type DbAccessSessionState,
  type DbAccessTab,
  type DbAccessTabInput,
  openDbAccessTab,
  setActiveDbAccessServiceTab,
  setActiveDbAccessTab,
  switchDbAccessSession,
  updateDbAccessTab,
} from "./session";

export type { DbAccessTab, DbAccessTabType } from "./session";

export type DbAccessEngineType =
  | "MYSQL"
  | "POSTGRES"
  | "MONGODB"
  | "REDIS"
  | "CLICKHOUSE";

export type DbAccessActivityTab = "db_service" | "analysis";

export type DbAccessSelectedItemType =
  | "db_service"
  | "database"
  | "schema"
  | "table_folder"
  | "view_folder"
  | "table"
  | "view"
  | "collection"
  | "key"
  | "redis_keys_folder"
  | "redis_key"
  | null;

export interface DbAccessSelectedItem {
  dbServiceKey?: string;
  id: string;
  metadata?: Record<string, unknown>;
  name: string;
  parentId?: string;
  type: DbAccessSelectedItemType;
}

export interface DbAccessService {
  databaseName: string;
  dbServiceKey: string;
  displayName: string;
  engineType: DbAccessEngineType;
  runtime: DataBrowserHostContext;
}

export interface DDLResult {
  message?: string;
  success: boolean;
}

interface DbAccessRefreshState {
  collectionRefreshKey: number;
  sidebarRefreshKey: number;
  tableRefreshKey: number;
}

const ENGINE_TYPE_BY_RUNTIME_ENGINE: Record<
  Exclude<DataBrowserEngine, "UNSUPPORTED">,
  DbAccessEngineType
> = {
  MONGODB: "MONGODB",
  MYSQL: "MYSQL",
  POSTGRES: "POSTGRES",
  REDIS: "REDIS",
};

const dbAccessSessionAtom = atom<DbAccessSessionState>(
  createDbAccessSession("")
);
const dbAccessSelectedItemAtom = atom<DbAccessSelectedItem | null>(null);
const dbAccessRefreshAtom = atom<DbAccessRefreshState>({
  collectionRefreshKey: 0,
  sidebarRefreshKey: 0,
  tableRefreshKey: 0,
});
const dbAccessActivityTabAtom = atom<DbAccessActivityTab>("db_service");
const DbAccessRuntimeContext = createContext<DataBrowserHostContext | null>(
  null
);

function disabledMutation(..._args: unknown[]): Promise<DDLResult> {
  return Promise.resolve({
    message: "DB Access is read-only in the current version.",
    success: false,
  });
}

export function dbAccessServiceFromRuntime(
  runtime: DataBrowserHostContext
): DbAccessService {
  return {
    databaseName: runtime.database.name,
    dbServiceKey: dbAccessSessionKeyFromRuntime(runtime),
    displayName: runtime.database.name || runtime.databaseWorkloadName,
    engineType:
      runtime.engine === "UNSUPPORTED"
        ? "POSTGRES"
        : ENGINE_TYPE_BY_RUNTIME_ENGINE[runtime.engine],
    runtime,
  };
}

export interface DbAccessSessionProviderProps {
  children: ReactNode;
  initialSession?: DbAccessSessionState;
  runtime: DataBrowserHostContext;
}

export function DbAccessSessionProvider({
  children,
  initialSession,
  runtime,
}: DbAccessSessionProviderProps) {
  const dbServiceKey = dbAccessSessionKeyFromRuntime(runtime);
  const selectedRootItem = useMemo<DbAccessSelectedItem>(
    () => ({
      dbServiceKey,
      id: dbServiceKey,
      metadata: {},
      name: runtime.database.name || runtime.databaseWorkloadName,
      type: "db_service",
    }),
    [dbServiceKey, runtime.database.name, runtime.databaseWorkloadName]
  );
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(
      dbAccessSessionAtom,
      initialSession ?? createDbAccessSession(dbServiceKey)
    );
    nextStore.set(dbAccessSelectedItemAtom, selectedRootItem);
    return nextStore;
  }, [dbServiceKey, initialSession, selectedRootItem]);

  useEffect(() => {
    store.set(dbAccessSessionAtom, (session) =>
      switchDbAccessSession(session, dbServiceKey)
    );
  }, [dbServiceKey, store]);

  return (
    <DbAccessRuntimeContext.Provider value={runtime}>
      <Provider store={store}>{children}</Provider>
    </DbAccessRuntimeContext.Provider>
  );
}

export function useDbAccessRuntime(): DataBrowserHostContext {
  const runtime = useContext(DbAccessRuntimeContext);
  if (!runtime) {
    throw new Error(
      "useDbAccessRuntime must be used within DbAccessSessionProvider"
    );
  }
  return runtime;
}

export function useDbAccessService(): DbAccessService {
  return dbAccessServiceFromRuntime(useDbAccessRuntime());
}

export function useDbAccessTabs() {
  const session = useAtomValue(dbAccessSessionAtom);
  const setSession = useSetAtom(dbAccessSessionAtom);

  const openTab = useCallback(
    (
      tab: Omit<DbAccessTabInput, "dbServiceKey"> & { dbServiceKey?: string }
    ) => {
      let tabId: string | null = null;
      setSession((current) => {
        const result = openDbAccessTab(current, {
          ...tab,
          dbServiceKey: tab.dbServiceKey ?? current.dbServiceKey,
        });
        tabId = result.tabId;
        return result.session;
      });
      return tabId ?? "";
    },
    [setSession]
  );

  const closeTab = useCallback(
    (tabId: string) =>
      setSession((current) => closeDbAccessTab(current, tabId)),
    [setSession]
  );

  const closeOtherTabs = useCallback(
    (tabId: string) =>
      setSession((current) => closeOtherDbAccessTabs(current, tabId)),
    [setSession]
  );

  const closeAllTabs = useCallback(
    () => setSession((current) => closeAllDbAccessTabs(current)),
    [setSession]
  );

  const setActiveTab = useCallback(
    (tabId: string) =>
      setSession((current) => setActiveDbAccessTab(current, tabId)),
    [setSession]
  );

  const setActiveServiceTab = useCallback(
    (tab: DbAccessServiceTab) =>
      setSession((current) => setActiveDbAccessServiceTab(current, tab)),
    [setSession]
  );

  const updateTab = useCallback(
    (tabId: string, updates: Partial<DbAccessTab>) =>
      setSession((current) => updateDbAccessTab(current, tabId, updates)),
    [setSession]
  );

  return {
    activeTabId: session.activeTabId,
    activeSurface: session.activeSurface,
    closeAllTabs,
    closeOtherTabs,
    closeTab,
    openTab,
    setActiveTab,
    setActiveServiceTab,
    tabs: session.tabs,
    updateTab,
  };
}

export function useDbAccessSelection() {
  const selectedItem = useAtomValue(dbAccessSelectedItemAtom);
  const setSelectedItem = useSetAtom(dbAccessSelectedItemAtom);

  return {
    selectItem: setSelectedItem,
    selectedItem,
  };
}

export function useDbAccessRefresh() {
  const refreshState = useAtomValue(dbAccessRefreshAtom);
  const setRefreshState = useSetAtom(dbAccessRefreshAtom);

  const triggerTableRefresh = useCallback(
    () =>
      setRefreshState((current) => ({
        ...current,
        tableRefreshKey: current.tableRefreshKey + 1,
      })),
    [setRefreshState]
  );

  const triggerCollectionRefresh = useCallback(
    () =>
      setRefreshState((current) => ({
        ...current,
        collectionRefreshKey: current.collectionRefreshKey + 1,
      })),
    [setRefreshState]
  );

  const triggerSidebarRefresh = useCallback(
    () =>
      setRefreshState((current) => ({
        ...current,
        sidebarRefreshKey: current.sidebarRefreshKey + 1,
      })),
    [setRefreshState]
  );

  return {
    ...refreshState,
    triggerCollectionRefresh,
    triggerSidebarRefresh,
    triggerTableRefresh,
  };
}

export function useDbAccessActivity() {
  const activeTab = useAtomValue(dbAccessActivityTabAtom);
  const setActiveTab = useSetAtom(dbAccessActivityTabAtom);

  return {
    activeTab,
    setActiveTab,
  };
}

export function useDbAccessReadOnlyActions() {
  const dbService = useDbAccessService();

  return useMemo(
    () => ({
      clearTableData: disabledMutation,
      copyTable: disabledMutation,
      createDatabase: disabledMutation,
      createTable: (..._args: [string, string, string, unknown[]]) =>
        disabledMutation(),
      deleteDatabase: disabledMutation,
      deleteTable: disabledMutation,
      dropCollection: disabledMutation,
      fetchDatabases: async (..._args: unknown[]): Promise<string[]> => [
        dbService.databaseName,
      ],
      fetchSchemas: async (..._args: unknown[]): Promise<string[]> => [],
      fetchSystemSchemas: async () => undefined,
      fetchTables: async (
        ..._args: unknown[]
      ): Promise<{ name: string; type: string }[]> => [],
      renameDatabase: disabledMutation,
      renameTable: disabledMutation,
      showSystemObjectsFor: new Set<string>(),
      systemSchemas: [] as string[],
      toggleSystemObjects: () => undefined,
    }),
    [dbService.databaseName]
  );
}
