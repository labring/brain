import {
  accessRowsToDataFlowTableData,
  getRows,
} from "@data-browser/api/access-adapter";
import type {
  AccessObjectRef,
  AccessRowsSort,
} from "@data-browser/api/access-types";
import {
  useDbAccessRefresh,
  useDbAccessRuntime,
} from "@data-browser/state/db-access-session";
import type { TableData } from "@data-browser/utils/graphql-transforms";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseDataQueryParams {
  currentPage: number;
  objectRef: AccessObjectRef;
  /** Called once when query returns columns and no visible columns are set yet. */
  onInitVisibleColumns: (columns: string[]) => void;
  pageSize: number;
  sortColumn: string | null;
  sortDirection: "asc" | "desc" | null;
  visibleColumnsCount: number;
}

/** State returned by useDataQuery. */
export interface DataQueryState {
  data: TableData | null;
  error: string | null;
  foreignKeyColumns: string[];
  loading: boolean;
  primaryKey: string | null;
  total: number;
  totalPages: number;
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
    objectRef,
    visibleColumnsCount,
    onInitVisibleColumns,
  } = params;

  const runtime = useDbAccessRuntime();
  const { tableRefreshKey } = useDbAccessRefresh();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<TableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [primaryKey, setPrimaryKey] = useState<string | null>(null);
  const [foreignKeyColumns, setForeignKeyColumns] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

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
        setPrimaryKey(tableData.primaryKey);
        setForeignKeyColumns(tableData.foreignKeyColumns);
        if (
          visibleColumnsCountRef.current === 0 &&
          tableData.columns.length > 0
        ) {
          onInitVisibleColumns(tableData.columns);
        }
      } catch (err: any) {
        if (thisRequestId !== latestRequestIdRef.current) {
          return;
        }
        setError(err.message || "Failed to fetch table data");
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
  }, [handleSubmitRequest, refreshKey, tableRefreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((prev) => prev + 1);
  }, []);

  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  return {
    state: {
      loading,
      data,
      error,
      primaryKey,
      foreignKeyColumns,
      total,
      totalPages,
    },
    actions: { refresh, handleSubmitRequest },
  };
}
