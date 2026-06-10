import type { AccessObjectRef } from "@data-browser/api/access-types";

export type DbAccessTabType = "table" | "collection" | "redis_key_detail";

export type DbAccessServiceTab = "backup";

export type DbAccessActiveSurface =
  | {
      kind: "service";
      tab: DbAccessServiceTab;
    }
  | {
      kind: "object";
      tabId: string;
    };

export interface DbAccessTab {
  collectionName?: string;
  databaseName?: string;
  dbServiceKey: string;
  id: string;
  isDirty?: boolean;
  objectRef?: AccessObjectRef;
  schemaName?: string;
  tableName?: string;
  title: string;
  type: DbAccessTabType;
}

export interface DbAccessSessionState {
  activeSurface: DbAccessActiveSurface;
  activeTabId: string | null;
  dbServiceKey: string;
  tabs: DbAccessTab[];
}

export type DbAccessTabInput = Omit<DbAccessTab, "id"> & { id?: string };

function objectSurface(tabId: string): DbAccessActiveSurface {
  return { kind: "object", tabId };
}

function serviceSurface(
  tab: DbAccessServiceTab = "backup"
): DbAccessActiveSurface {
  return { kind: "service", tab };
}

function surfaceForActiveTab(tabId: string | null): DbAccessActiveSurface {
  return tabId === null ? serviceSurface() : objectSurface(tabId);
}

export function createDbAccessSession(
  dbServiceKey: string
): DbAccessSessionState {
  return {
    activeSurface: serviceSurface(),
    activeTabId: null,
    dbServiceKey,
    tabs: [],
  };
}

export function switchDbAccessSession(
  session: DbAccessSessionState,
  dbServiceKey: string
): DbAccessSessionState {
  if (session.dbServiceKey === dbServiceKey) {
    return session;
  }

  return createDbAccessSession(dbServiceKey);
}

export function dbAccessObjectTabId(ref: AccessObjectRef): string {
  return `object:${ref.kind}:${JSON.stringify(ref.path)}`;
}

function generateTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function findExistingDbAccessTab(
  session: DbAccessSessionState,
  tab: DbAccessTabInput
): DbAccessTab | undefined {
  if (tab.objectRef) {
    const canonicalId = dbAccessObjectTabId(tab.objectRef);
    return session.tabs.find((candidate) => candidate.id === canonicalId);
  }

  return session.tabs.find((candidate) => {
    if (
      candidate.type !== tab.type ||
      candidate.dbServiceKey !== tab.dbServiceKey
    ) {
      return false;
    }

    if (tab.databaseName && candidate.databaseName !== tab.databaseName) {
      return false;
    }

    if (tab.type === "table") {
      return candidate.tableName === tab.tableName;
    }

    if (tab.type === "collection") {
      return candidate.collectionName === tab.collectionName;
    }

    if (tab.type === "redis_key_detail") {
      return candidate.tableName === tab.tableName;
    }

    return false;
  });
}

export function openDbAccessTab(
  session: DbAccessSessionState,
  tab: DbAccessTabInput
): { session: DbAccessSessionState; tabId: string | null } {
  const existingTab = findExistingDbAccessTab(session, tab);

  if (existingTab) {
    return {
      session: {
        ...session,
        activeSurface: objectSurface(existingTab.id),
        activeTabId: existingTab.id,
      },
      tabId: existingTab.id,
    };
  }

  const newTab: DbAccessTab = {
    ...tab,
    id:
      tab.id ||
      (tab.objectRef ? dbAccessObjectTabId(tab.objectRef) : generateTabId()),
  };

  return {
    session: {
      ...session,
      activeSurface: objectSurface(newTab.id),
      activeTabId: newTab.id,
      tabs: [...session.tabs, newTab],
    },
    tabId: newTab.id,
  };
}

export function closeDbAccessTab(
  session: DbAccessSessionState,
  tabId: string
): DbAccessSessionState {
  const index = session.tabs.findIndex((tab) => tab.id === tabId);
  const tabs = session.tabs.filter((tab) => tab.id !== tabId);
  let activeTabId = session.activeTabId;

  if (session.activeTabId === tabId) {
    activeTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
  }

  return {
    ...session,
    activeSurface: surfaceForActiveTab(activeTabId),
    activeTabId,
    tabs,
  };
}

export function closeOtherDbAccessTabs(
  session: DbAccessSessionState,
  tabId: string
): DbAccessSessionState {
  const tab = session.tabs.find((candidate) => candidate.id === tabId);
  if (!tab) {
    return session;
  }

  return {
    ...session,
    activeSurface: objectSurface(tabId),
    activeTabId: tabId,
    tabs: [tab],
  };
}

export function closeAllDbAccessTabs(
  session: DbAccessSessionState
): DbAccessSessionState {
  return {
    ...session,
    activeSurface: serviceSurface(),
    activeTabId: null,
    tabs: [],
  };
}

export function setActiveDbAccessTab(
  session: DbAccessSessionState,
  tabId: string
): DbAccessSessionState {
  return {
    ...session,
    activeSurface: objectSurface(tabId),
    activeTabId: tabId,
  };
}

export function setActiveDbAccessServiceTab(
  session: DbAccessSessionState,
  tab: DbAccessServiceTab
): DbAccessSessionState {
  return {
    ...session,
    activeSurface: serviceSurface(tab),
    activeTabId: null,
  };
}

export function openDbAccessServiceTab(
  session: DbAccessSessionState,
  tab: DbAccessServiceTab
): DbAccessSessionState {
  return setActiveDbAccessServiceTab(session, tab);
}

export function updateDbAccessTab(
  session: DbAccessSessionState,
  tabId: string,
  updates: Partial<DbAccessTab>
): DbAccessSessionState {
  return {
    ...session,
    tabs: session.tabs.map((tab) =>
      tab.id === tabId ? { ...tab, ...updates } : tab
    ),
  };
}
