"use client";

import type { DataBrowserHostContext } from "@db-browser/api/access-types";
import type { DataBrowserEngine } from "@db-browser/api/engine";
import { atom, createStore, Provider, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  createDbAccessViewStateRegistry,
  DbAccessViewStateRegistryContext,
  useDbAccessViewStateRegistry,
} from "./db-access-view-state";
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
const dbAccessActivityTabAtom = atom<DbAccessActivityTab>("db_service");
/**
 * Logical Database names whose System Objects are revealed. Lives in the
 * per-session store (never persisted), so switching DB Services resets every
 * database to the clean default view (ADR 0054).
 */
export const dbAccessRevealedSystemObjectsAtom = atom<ReadonlySet<string>>(
  new Set<string>()
);
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
  // One registry per DB service: recreated via keyed state (a plain useMemo
  // would need dbServiceKey as an unused — and thus flagged — dependency).
  const [viewStateRegistryState, setViewStateRegistryState] = useState(() => ({
    key: dbServiceKey,
    registry: createDbAccessViewStateRegistry(),
  }));
  if (viewStateRegistryState.key !== dbServiceKey) {
    setViewStateRegistryState({
      key: dbServiceKey,
      registry: createDbAccessViewStateRegistry(),
    });
  }
  const viewStateRegistry = viewStateRegistryState.registry;
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

  useEffect(
    () => () => {
      viewStateRegistry.disposeAll();
    },
    [viewStateRegistry]
  );

  return (
    <DbAccessViewStateRegistryContext value={viewStateRegistry}>
      <DbAccessRuntimeContext.Provider value={runtime}>
        <Provider store={store}>{children}</Provider>
      </DbAccessRuntimeContext.Provider>
    </DbAccessViewStateRegistryContext>
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
  const viewStateRegistry = useDbAccessViewStateRegistry();

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
    (tabId: string) => {
      viewStateRegistry.disposeView(tabId);
      setSession((current) => closeDbAccessTab(current, tabId));
    },
    [setSession, viewStateRegistry]
  );

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      for (const tab of session.tabs) {
        if (tab.id !== tabId) {
          viewStateRegistry.disposeView(tab.id);
        }
      }
      setSession((current) => closeOtherDbAccessTabs(current, tabId));
    },
    [session.tabs, setSession, viewStateRegistry]
  );

  const closeAllTabs = useCallback(() => {
    viewStateRegistry.disposeAll();
    setSession((current) => closeAllDbAccessTabs(current));
  }, [setSession, viewStateRegistry]);

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

export function useSelectDbAccessItem() {
  return useSetAtom(dbAccessSelectedItemAtom);
}

export function useDbAccessIsSelected(itemId: string) {
  const isSelectedAtom = useMemo(
    () =>
      selectAtom(
        dbAccessSelectedItemAtom,
        (selectedItem) => selectedItem?.id === itemId
      ),
    [itemId]
  );
  return useAtomValue(isSelectedAtom);
}

export function useDbAccessActivity() {
  const activeTab = useAtomValue(dbAccessActivityTabAtom);
  const setActiveTab = useSetAtom(dbAccessActivityTabAtom);

  return {
    activeTab,
    setActiveTab,
  };
}

export function useDbAccessSystemObjectsReveal() {
  const revealedDatabases = useAtomValue(dbAccessRevealedSystemObjectsAtom);
  const setRevealedDatabases = useSetAtom(dbAccessRevealedSystemObjectsAtom);

  const toggleSystemObjects = useCallback(
    (database: string) => {
      setRevealedDatabases((current) => {
        const next = new Set(current);
        if (next.has(database)) {
          next.delete(database);
        } else {
          next.add(database);
        }
        return next;
      });
    },
    [setRevealedDatabases]
  );

  return { revealedDatabases, toggleSystemObjects };
}

/**
 * Per-node selector on the reveal aggregate: a Tree Node subscribes
 * only to whether one Logical Database has its System Objects revealed, so a
 * toggle re-renders that database's nodes instead of broadcasting the whole
 * set to every rendered node.
 */
export function useDbAccessDatabaseSystemObjectsRevealed(
  database: string | undefined
): boolean {
  const revealedAtom = useMemo(
    () =>
      selectAtom(dbAccessRevealedSystemObjectsAtom, (revealedDatabases) =>
        database === undefined ? false : revealedDatabases.has(database)
      ),
    [database]
  );
  return useAtomValue(revealedAtom);
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
      fetchTables: async (
        ..._args: unknown[]
      ): Promise<{ name: string; type: string }[]> => [],
      renameDatabase: disabledMutation,
      renameTable: disabledMutation,
    }),
    [dbService.databaseName]
  );
}
