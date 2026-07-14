import type {
  AccessObjectRef,
  DataFlowTableData,
} from "@db-browser/api/access-types";
import { ColumnResizeGuide } from "@db-browser/components/database/shared/ColumnResizeGuide";
import { DataView } from "@db-browser/components/database/shared/DataView";
import {
  FindBar,
  useFindInView,
} from "@db-browser/components/database/shared/FindBar";
import { useColumnResize } from "@db-browser/components/database/shared/useColumnResize";
import {
  type DbAccessSortState,
  useDbAccessViewState,
} from "@db-browser/state/db-access-view-state";
import { useAtomValue, useSetAtom } from "jotai";
import { type RefObject, useCallback, useMemo, useRef } from "react";
import { TableViewDataGrid } from "./TableView/TableView.DataGrid";
import { TableViewToolbar } from "./TableView/TableView.Toolbar";
import type { RenderedTableRow } from "./TableView/types";
import { useDataQuery } from "./TableView/useDataQuery";

interface TableDetailViewProps {
  active: boolean;
  databaseName: string;
  dbServiceKey: string;
  objectRef: AccessObjectRef;
  schema?: string;
  tableName: string;
  viewKey: string;
}

interface TableFindRegionProps {
  active: boolean;
  data: DataFlowTableData | null;
  loading: boolean;
  onClearSort: () => void;
  onSort: (column: string, direction: "asc" | "desc") => void;
  renderedRows: RenderedTableRow[];
  resize: ReturnType<typeof useColumnResize>;
  rootRef: RefObject<HTMLDivElement | null>;
  sort: DbAccessSortState;
  viewKey: string;
  visibleColumns: string[];
}

function buildExistingRowKey(pageOffset: number, sourceRowIndex: number) {
  return `existing-${pageOffset + sourceRowIndex}`;
}

function normalizeCellValue(value: unknown) {
  return value == null ? null : String(value);
}

function TableFindRegion({
  active,
  data,
  loading,
  onClearSort,
  onSort,
  renderedRows,
  resize,
  rootRef,
  sort,
  viewKey,
  visibleColumns,
}: TableFindRegionProps) {
  const findRows = useMemo(
    () => renderedRows.map((row) => row.values),
    [renderedRows]
  );
  const find = useFindInView({
    active,
    columns: visibleColumns,
    rootRef,
    rows: findRows,
    viewKey,
  });

  return (
    <>
      <FindBar.Bar find={find} />
      <TableViewDataGrid
        data={data}
        find={find}
        loading={loading}
        onClearSort={onClearSort}
        onSort={onSort}
        renderedRows={renderedRows}
        resize={resize}
        sort={sort}
        visibleColumnNames={visibleColumns}
      />
    </>
  );
}

export function TableDetailView({
  active,
  databaseName,
  dbServiceKey,
  objectRef,
  schema,
  tableName,
  viewKey,
}: TableDetailViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewState = useDbAccessViewState(viewKey);
  const pagination = useAtomValue(viewState.paginationAtom);
  const sort = useAtomValue(viewState.sortAtom);
  const visibleColumns = useAtomValue(viewState.visibleColumnsAtom);
  const setCurrentPage = useSetAtom(viewState.setCurrentPageAtom);
  const setPageSize = useSetAtom(viewState.setPageSizeAtom);
  const setSort = useSetAtom(viewState.setSortAtom);
  const clearSort = useSetAtom(viewState.clearSortAtom);
  const setVisibleColumns = useSetAtom(viewState.visibleColumnsAtom);
  const resize = useColumnResize({ rootRef, viewKey });

  const { state: queryState, actions: queryActions } = useDataQuery({
    currentPage: pagination.currentPage,
    objectRef,
    onInitVisibleColumns: setVisibleColumns,
    pageSize: pagination.pageSize,
    sortColumn: sort.column,
    sortDirection: sort.direction,
    viewKey,
    visibleColumnsCount: visibleColumns.length,
  });

  const pageOffset = (pagination.currentPage - 1) * pagination.pageSize;
  const renderedRows = useMemo<RenderedTableRow[]>(
    () =>
      (queryState.data?.rows ?? []).map((row, sourceRowIndex) => {
        const originalRow = Object.fromEntries(
          Object.entries(row).map(([column, value]) => [
            column,
            normalizeCellValue(value),
          ])
        );

        return {
          originalRow,
          rowKey: buildExistingRowKey(pageOffset, sourceRowIndex),
          rowNumber: pageOffset + sourceRowIndex + 1,
          sourceRowIndex,
          values: originalRow,
        };
      }),
    [pageOffset, queryState.data?.rows]
  );
  const total = queryState.data?.total ?? 0;
  const totalPages = Math.ceil(total / pagination.pageSize);
  const handleSort = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setSort({ column, direction });
    },
    [setSort]
  );

  return (
    <div
      className="relative flex h-full flex-col"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-loading={queryState.loading ? "true" : "false"}
      data-qa-module="sql"
      data-qa-object="table-detail"
      data-qa-resource-id={tableName}
      data-qa-resource-type="table"
      data-qa-schema={schema}
      data-qa-state={
        queryState.error ? "error" : queryState.loading ? "loading" : "ready"
      }
      data-testid="sql.table.detail"
      ref={rootRef}
      style={resize.getRootStyle(visibleColumns)}
    >
      <ColumnResizeGuide />
      <TableViewToolbar
        databaseName={databaseName}
        dbServiceKey={dbServiceKey}
        loading={queryState.loading}
        objectRef={objectRef}
        onRefresh={queryActions.refresh}
        schema={schema}
        tableName={tableName}
      />

      {queryState.error ? (
        <DataView.Error
          message={queryState.error}
          onRetry={() => queryActions.handleSubmitRequest()}
        />
      ) : (
        <TableFindRegion
          active={active}
          data={queryState.data}
          loading={queryState.loading}
          onClearSort={clearSort}
          onSort={handleSort}
          renderedRows={renderedRows}
          resize={resize}
          rootRef={rootRef}
          sort={sort}
          viewKey={viewKey}
          visibleColumns={visibleColumns}
        />
      )}

      {total > 0 && (
        <DataView.Pagination
          currentPage={pagination.currentPage}
          itemLabel="rows"
          loading={queryState.loading}
          onPageChange={setCurrentPage}
          onPageSizeChange={setPageSize}
          pageSize={pagination.pageSize}
          total={total}
          totalPages={totalPages}
        />
      )}
    </div>
  );
}
