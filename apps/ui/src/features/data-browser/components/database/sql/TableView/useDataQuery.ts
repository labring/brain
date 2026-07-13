import {
  accessRowsToDataFlowTableData,
  getRows,
} from "@data-browser/api/access-adapter";
import type {
  AccessObjectRef,
  AccessRowsSort,
  DataFlowTableData,
} from "@data-browser/api/access-types";
import { useDbAccessRuntime } from "@data-browser/state/db-access-session";
import { useDbAccessViewState } from "@data-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseDataQueryParams {
  currentPage: number;
  objectRef: AccessObjectRef;
  /** Called once when query returns columns and no visible columns are set yet. */
  onInitVisibleColumns: (columns: string[]) => void;
  pageSize: number;
  sortColumn: string | null;
  sortDirection: "asc" | "desc" | null;
  viewKey: string;
  visibleColumnsCount: number;
}

/** State returned by useDataQuery. */
export interface DataQueryState {
  data: DataFlowTableData | null;
  error: string | null;
  loading: boolean;
}

/** Actions returned by useDataQuery. */
export interface DataQueryActions {
  handleSubmitRequest: (overridePageOffset?: number) => Promise<void>;
  refresh: () => void;
}

/** Hook that owns data fetching, loading/error state, and race condition prevention for TableView. */
export function useDataQuery(params: UseDataQueryParams): {
  state: DataQueryState;
  actions: DataQueryActions;
} {
  const {
    currentPage,
    pageSize,
    sortColumn,
    sortDirection,
    viewKey,
    objectRef,
    visibleColumnsCount,
    onInitVisibleColumns,
  } = params;

  const runtime = useDbAccessRuntime();
  const viewState = useDbAccessViewState(viewKey);
  const refreshVersion = useAtomValue(viewState.refreshVersionAtom);
  const refresh = useSetAtom(viewState.triggerRefreshAtom);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DataFlowTableData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestRequestIdRef = useRef(0);
  const visibleColumnsCountRef = useRef(visibleColumnsCount);
  visibleColumnsCountRef.current = visibleColumnsCount;

  const handleSubmitRequest = useCallback(
    async (overridePageOffset?: number) => {
      setLoading(true);
      setError(null);

      latestRequestIdRef.current += 1;
      const thisRequestId = latestRequestIdRef.current;

      const sort: AccessRowsSort[] | undefined =
        sortColumn && sortDirection
          ? [
              {
                column: sortColumn,
                direction: sortDirection === "asc" ? "ASC" : "DESC",
              },
            ]
          : undefined;

      try {
        const result = await getRows({
          runtime,
          ref: objectRef,
          pageSize,
          pageOffset: overridePageOffset ?? (currentPage - 1) * pageSize,
          sort,
        });

        if (thisRequestId !== latestRequestIdRef.current) {
          return;
        }

        const tableData = accessRowsToDataFlowTableData(result);
        setData(tableData);
        if (
          visibleColumnsCountRef.current === 0 &&
          tableData.columns.length > 0
        ) {
          onInitVisibleColumns(tableData.columns);
        }
      } catch (err: unknown) {
        if (thisRequestId !== latestRequestIdRef.current) {
          return;
        }
        setError(
          err instanceof Error ? err.message : "Failed to fetch table data"
        );
      } finally {
        if (thisRequestId === latestRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [
      runtime,
      sortColumn,
      sortDirection,
      pageSize,
      currentPage,
      objectRef,
      onInitVisibleColumns,
    ]
  );

  // Fetch on mount and when data-changing params change
  useEffect(() => {
    handleSubmitRequest();
  }, [handleSubmitRequest, refreshVersion]);

  return {
    state: {
      loading,
      data,
      error,
    },
    actions: { handleSubmitRequest, refresh },
  };
}
