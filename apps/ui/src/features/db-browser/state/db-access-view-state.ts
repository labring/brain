import { atom, type PrimitiveAtom, useStore, type WritableAtom } from "jotai";
import { createContext, useCallback, useContext } from "react";

/**
 * DB Access state ownership:
 * - this registry owns cross-component interaction state for one session;
 * - query results stay in query hooks;
 * - component-private controls stay local;
 * - frame-by-frame pointer state stays in refs and the DOM.
 */

export interface DbAccessPaginationState {
  currentPage: number;
  pageSize: number;
}

export interface DbAccessSortState {
  column: string | null;
  direction: "asc" | "desc" | null;
}

export interface DbAccessViewStateAtoms {
  clearSortAtom: WritableAtom<null, [], void>;
  columnWidthAtom: (column: string) => PrimitiveAtom<number | null>;
  currentFindMatchAtom: PrimitiveAtom<number>;
  findTermAtom: PrimitiveAtom<string>;
  paginationAtom: PrimitiveAtom<DbAccessPaginationState>;
  refreshVersionAtom: PrimitiveAtom<number>;
  setCurrentPageAtom: WritableAtom<null, [number], void>;
  setFindTermAtom: WritableAtom<null, [string], void>;
  setPageSizeAtom: WritableAtom<null, [number], void>;
  setSortAtom: WritableAtom<
    null,
    [{ column: string; direction: "asc" | "desc" }],
    void
  >;
  sortAtom: PrimitiveAtom<DbAccessSortState>;
  triggerRefreshAtom: WritableAtom<null, [], void>;
  visibleColumnsAtom: PrimitiveAtom<string[]>;
}

export interface DbAccessViewStateRegistry {
  disposeAll: () => void;
  disposeView: (viewKey: string) => void;
  getView: (viewKey: string) => DbAccessViewStateAtoms | undefined;
  view: (viewKey: string) => DbAccessViewStateAtoms;
}

export const DbAccessViewStateRegistryContext =
  createContext<DbAccessViewStateRegistry | null>(null);

export function useDbAccessViewStateRegistry(): DbAccessViewStateRegistry {
  const registry = useContext(DbAccessViewStateRegistryContext);
  if (!registry) {
    throw new Error(
      "useDbAccessViewStateRegistry must be used within DbAccessSessionProvider"
    );
  }
  return registry;
}

export function useDbAccessViewState(viewKey: string): DbAccessViewStateAtoms {
  return useDbAccessViewStateRegistry().view(viewKey);
}

export function useTriggerDbAccessViewRefresh() {
  const registry = useDbAccessViewStateRegistry();
  const store = useStore();

  return useCallback(
    (viewKey: string) => {
      const view = registry.getView(viewKey);
      if (view) {
        store.set(view.triggerRefreshAtom);
      }
    },
    [registry, store]
  );
}

const DEFAULT_PAGINATION: DbAccessPaginationState = {
  currentPage: 1,
  pageSize: 50,
};

const DEFAULT_SORT: DbAccessSortState = {
  column: null,
  direction: null,
};

function createViewStateAtoms(): DbAccessViewStateAtoms {
  const paginationAtom = atom<DbAccessPaginationState>(DEFAULT_PAGINATION);
  const sortAtom = atom<DbAccessSortState>(DEFAULT_SORT);
  const visibleColumnsAtom = atom<string[]>([]);
  const findTermAtom = atom("");
  const currentFindMatchAtom = atom(0);
  const refreshVersionAtom = atom(0);
  const columnWidthAtoms = new Map<string, PrimitiveAtom<number | null>>();

  return {
    clearSortAtom: atom(null, (_get, set) => {
      set(sortAtom, DEFAULT_SORT);
    }),
    columnWidthAtom(column) {
      const existing = columnWidthAtoms.get(column);
      if (existing) {
        return existing;
      }
      const widthAtom = atom<number | null>(null);
      columnWidthAtoms.set(column, widthAtom);
      return widthAtom;
    },
    currentFindMatchAtom,
    findTermAtom,
    paginationAtom,
    refreshVersionAtom,
    setCurrentPageAtom: atom(null, (_get, set, currentPage: number) => {
      set(paginationAtom, (current) => ({ ...current, currentPage }));
    }),
    setFindTermAtom: atom(null, (_get, set, term: string) => {
      set(findTermAtom, term);
      set(currentFindMatchAtom, 0);
    }),
    setPageSizeAtom: atom(null, (_get, set, pageSize: number) => {
      set(paginationAtom, { currentPage: 1, pageSize });
    }),
    setSortAtom: atom(
      null,
      (_get, set, nextSort: { column: string; direction: "asc" | "desc" }) => {
        set(sortAtom, nextSort);
      }
    ),
    sortAtom,
    triggerRefreshAtom: atom(null, (get, set) => {
      set(refreshVersionAtom, get(refreshVersionAtom) + 1);
    }),
    visibleColumnsAtom,
  };
}

export function createDbAccessViewStateRegistry(): DbAccessViewStateRegistry {
  const views = new Map<string, DbAccessViewStateAtoms>();

  return {
    disposeAll() {
      views.clear();
    },
    disposeView(viewKey) {
      views.delete(viewKey);
    },
    getView(viewKey) {
      return views.get(viewKey);
    },
    view(viewKey) {
      const existing = views.get(viewKey);
      if (existing) {
        return existing;
      }
      const view = createViewStateAtoms();
      views.set(viewKey, view);
      return view;
    },
  };
}
