import type { AccessObjectRef } from "@data-browser/api/access-types";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  RenderedTableRow,
  TableViewActions,
  TableViewContextValue,
  TableViewState,
} from "./types";
import { useColumnResize } from "./useColumnResize";
import { useDataQuery } from "./useDataQuery";

const TableViewCtx = createContext<TableViewContextValue | null>(null);

/** Hook to access TableView context. Throws if used outside TableViewProvider. */
export function useTableView(): TableViewContextValue {
  const ctx = use(TableViewCtx);
  if (!ctx) {
    throw new Error("useTableView must be used within TableViewProvider");
  }
  return ctx;
}

/** Simplify verbose PostgreSQL column type names for display. */
export function simplifyColumnType(typeStr: string): string {
  if (!typeStr) {
    return "";
  }
  return typeStr
    .replace(/ varying/gi, "")
    .replace(/ without time zone/gi, "")
    .replace(/ with time zone/gi, " tz")
    .replace(/character/gi, "char")
    .replace(/double precision/gi, "double")
    .trim();
}

interface TableViewProviderProps {
  children: ReactNode;
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
  schema?: string;
  tableName: string;
}

function buildExistingRowKey(pageOffset: number, sourceRowIndex: number) {
  return `existing-${pageOffset + sourceRowIndex}`;
}

function normalizeCellValue(value: unknown) {
  return value == null ? null : String(value);
}

/** Provider that owns SQL table data, pagination, sorting, export, and column sizing. */
export function TableViewProvider({
  dbServiceKey,
  databaseName,
  tableName,
  objectRef,
  schema,
  children,
}: TableViewProviderProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const lastTableRef = useRef<string>("");

  const onInitVisibleColumns = useCallback((columns: string[]) => {
    setVisibleColumns(columns);
  }, []);

  const { state: queryState, actions: queryActions } = useDataQuery({
    currentPage,
    pageSize,
    sortColumn,
    sortDirection,
    objectRef,
    visibleColumnsCount: visibleColumns.length,
    onInitVisibleColumns,
  });

  const { columnWidths, resizingColumn, resizedColumns, handleResizeStart } =
    useColumnResize(queryState.data?.columns);

  const pageOffset = (currentPage - 1) * pageSize;
  const renderedRows: RenderedTableRow[] = (queryState.data?.rows ?? []).map(
    (row, sourceRowIndex) => {
      const originalRow = Object.fromEntries(
        Object.entries(row).map(([column, value]) => [
          column,
          normalizeCellValue(value),
        ])
      );

      return {
        rowKey: buildExistingRowKey(pageOffset, sourceRowIndex),
        sourceRowIndex,
        rowNumber: pageOffset + sourceRowIndex + 1,
        originalRow,
        values: originalRow,
      };
    }
  );

  useEffect(() => {
    const currentTableKey = `${dbServiceKey}:${databaseName}:${schema || ""}:${tableName}`;
    if (lastTableRef.current !== currentTableKey) {
      lastTableRef.current = currentTableKey;
      setVisibleColumns([]);
      setSortColumn(null);
      setSortDirection(null);
      setCurrentPage(1);
    }
  }, [dbServiceKey, databaseName, schema, tableName]);

  const handleSort = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setSortColumn(column);
      setSortDirection(direction);
      setActiveColumnMenu(null);
    },
    []
  );

  const clearSort = useCallback(() => {
    setSortColumn(null);
    setSortDirection(null);
    setActiveColumnMenu(null);
  }, []);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  const state: TableViewState = {
    ...queryState,
    currentPage,
    pageSize,
    visibleColumns,
    sortColumn,
    sortDirection,
    activeColumnMenu,
    renderedRows,
    columnWidths,
    resizingColumn,
    resizedColumns,
    showExportModal,
  };

  const actions: TableViewActions = {
    refresh: queryActions.refresh,
    handleSubmitRequest: queryActions.handleSubmitRequest,
    handlePageChange,
    handlePageSizeChange,
    handleSort,
    clearSort,
    setActiveColumnMenu,
    handleResizeStart,
    setShowExportModal,
  };

  return <TableViewCtx value={{ state, actions }}>{children}</TableViewCtx>;
}
