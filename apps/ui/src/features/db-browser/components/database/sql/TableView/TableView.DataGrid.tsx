import type { DataFlowTableData } from "@db-browser/api/access-types";
import { ColumnResizeHandle } from "@db-browser/components/database/shared/ColumnResizeHandle";
import type { DataViewSortDirection } from "@db-browser/components/database/shared/DataViewSortMenu";
import {
  type FindBarModel,
  type FindHighlight,
  findCellHighlight,
} from "@db-browser/components/database/shared/FindBar";
import {
  columnWidthStyle,
  type useColumnResize,
} from "@db-browser/components/database/shared/useColumnResize";
import type { DbAccessSortState } from "@db-browser/state/db-access-view-state";
import { cn } from "@workspace/ui/lib/utils";
import { EyeOff, Loader2 } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { TableViewColumnHeader } from "./TableView.ColumnHeader";
import type { RenderedTableRow } from "./types";

interface TableViewDataGridProps {
  data: DataFlowTableData | null;
  find: FindBarModel;
  loading: boolean;
  onClearSort: () => void;
  onSort: (column: string, direction: DataViewSortDirection) => void;
  renderedRows: RenderedTableRow[];
  resize: ReturnType<typeof useColumnResize>;
  sort: DbAccessSortState;
  visibleColumnNames: string[];
}

interface DataCellProps {
  column: string;
  columnIndex: number;
  displayValue: string | null;
  highlight: FindHighlight;
  resize: ReturnType<typeof useColumnResize>;
  rowKey: string;
  targetId: string;
}

const DataCell = memo(function DataCell({
  column,
  columnIndex,
  displayValue,
  highlight,
  resize,
  rowKey,
  targetId,
}: DataCellProps) {
  return (
    <td
      className={cn(
        "relative scroll-mt-14 overflow-hidden border-border border-r border-b text-foreground/80 text-sm",
        "px-4 py-2",
        highlight === "current" && "bg-input",
        highlight === "match" && "bg-input/30"
      )}
      data-db-access-column={column}
      data-find-current={highlight === "current" ? "true" : undefined}
      data-qa-disabled-reason="read_only"
      data-qa-field={column}
      data-qa-module="sql"
      data-qa-object="table-cell"
      data-qa-resource-id={rowKey}
      data-qa-resource-type="table-row"
      data-qa-state="read_only"
      data-testid="sql.table.cell"
      id={targetId}
      style={columnWidthStyle(column, columnIndex)}
    >
      <span className="block truncate" title={displayValue ?? "NULL"}>
        {displayValue == null ? (
          <span className="text-muted-foreground italic">NULL</span>
        ) : (
          String(displayValue)
        )}
      </span>
      <ColumnResizeHandle
        column={column}
        columnIndex={columnIndex}
        resize={resize}
      />
    </td>
  );
});

/** Renders the SQL grid and subscribes only to committed column widths. */
export function TableViewDataGrid({
  data,
  find,
  loading,
  onClearSort,
  onSort,
  renderedRows,
  resize,
  sort,
  visibleColumnNames,
}: TableViewDataGridProps) {
  const visibleColumns = useMemo(
    () =>
      data?.columns.filter((column) => visibleColumnNames.includes(column)) ??
      [],
    [data, visibleColumnNames]
  );
  const hiddenColumnCount = data
    ? data.columns.length - visibleColumns.length
    : 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolledX, setIsScrolledX] = useState(false);
  const [isScrolledY, setIsScrolledY] = useState(false);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) {
      setIsScrolledX(element.scrollLeft > 0);
      setIsScrolledY(element.scrollTop > 0);
    }
  }, []);

  if (loading && !data) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-qa-loading="true"
        data-qa-module="sql"
        data-qa-object="table-grid"
        data-qa-state="loading"
        data-testid="sql.table.grid-loading"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 overflow-auto"
      data-db-access-grid-scroll=""
      data-qa-module="sql"
      data-qa-object="table-grid"
      data-qa-row-count={renderedRows.length}
      data-qa-state={renderedRows.length > 0 ? "ready" : "empty"}
      data-scrolled-x={isScrolledX || undefined}
      data-scrolled-y={isScrolledY || undefined}
      data-testid="sql.table.grid-scroll"
      onScroll={handleScroll}
      ref={scrollRef}
    >
      <table
        className="min-w-full border-collapse text-sm"
        data-qa-module="sql"
        data-qa-object="table-grid"
        data-qa-state={renderedRows.length > 0 ? "ready" : "empty"}
        data-testid="sql.table.grid"
      >
        <thead className="border-border border-b bg-transparent">
          <tr>
            <th
              className="sticky top-0 left-0 z-50 overflow-hidden border-border border-r border-b bg-db-access-sticky-header-surface px-2 py-2 text-center font-semibold text-muted-foreground text-xs"
              style={{ width: 48, minWidth: 48, maxWidth: 48 }}
            />
            {visibleColumns.map((column, index) => (
              <TableViewColumnHeader
                column={column}
                columnType={data?.columnTypes[column]}
                index={index}
                isForeignKey={data?.foreignKeyColumns.includes(column) ?? false}
                isPrimaryKey={data?.primaryKey === column}
                key={column}
                onClearSort={onClearSort}
                onSort={onSort}
                resize={resize}
                sort={sort}
              />
            ))}
            {hiddenColumnCount > 0 && (
              <th
                className="sticky top-0 z-40 overflow-hidden border-border border-b bg-db-access-sticky-header-surface px-4 py-2 text-center font-medium text-muted-foreground text-xs"
                title={`${hiddenColumnCount} hidden column(s)`}
              >
                <div className="relative z-10 flex items-center justify-center gap-1">
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>{hiddenColumnCount}</span>
                </div>
              </th>
            )}
            <th className="sticky top-0 z-40 w-full overflow-hidden border-border border-b bg-db-access-sticky-header-surface" />
          </tr>
        </thead>
        <tbody className="bg-transparent">
          {renderedRows.map((row, rowIndex) => (
            <tr
              className="group transition-colors hover:bg-input/30"
              data-qa-module="sql"
              data-qa-object="table-row"
              data-qa-resource-id={row.rowKey}
              data-qa-resource-type="table-row"
              data-qa-state="ready"
              data-testid="sql.table.row"
              key={row.rowKey}
            >
              <td
                className="sticky left-0 z-30 border-border border-r border-b bg-[#0C1120] px-2 py-2 text-center font-normal text-sm"
                data-qa-module="sql"
                data-qa-object="table-row"
                data-qa-resource-id={row.rowKey}
                data-qa-resource-type="table-row"
                data-qa-state="ready"
                data-testid="sql.table.row-selector"
                style={{ width: 48, minWidth: 48, maxWidth: 48 }}
              >
                {row.rowNumber ?? ""}
              </td>

              {visibleColumns.map((column, columnIndex) => (
                <DataCell
                  column={column}
                  columnIndex={columnIndex}
                  displayValue={row.values[column] ?? null}
                  highlight={findCellHighlight(
                    find.state.highlightIndex,
                    find.state.currentMatch,
                    rowIndex,
                    column
                  )}
                  key={column}
                  resize={resize}
                  rowKey={row.rowKey}
                  targetId={find.meta.getTargetId(rowIndex, column)}
                />
              ))}

              {hiddenColumnCount > 0 && (
                <td className="border-border border-b bg-transparent" />
              )}
              <td className="w-full border-border border-b bg-transparent" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
