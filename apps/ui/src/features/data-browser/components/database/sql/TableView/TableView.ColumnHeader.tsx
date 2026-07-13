import { ColumnResizeHandle } from "@data-browser/components/database/shared/ColumnResizeHandle";
import {
  type DataViewSortDirection,
  DataViewSortMenu,
} from "@data-browser/components/database/shared/DataViewSortMenu";
import {
  columnWidthStyle,
  type useColumnResize,
} from "@data-browser/components/database/shared/useColumnResize";
import type { DbAccessSortState } from "@data-browser/state/db-access-view-state";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { memo } from "react";

interface ColumnHeaderProps {
  column: string;
  columnType?: string;
  index: number;
  isForeignKey: boolean;
  isPrimaryKey: boolean;
  onClearSort: () => void;
  onSort: (column: string, direction: DataViewSortDirection) => void;
  resize: ReturnType<typeof useColumnResize>;
  sort: DbAccessSortState;
}

/** Simplify verbose PostgreSQL column type names for display. */
function simplifyColumnType(typeStr: string): string {
  return typeStr
    .replace(/ varying/gi, "")
    .replace(/ without time zone/gi, "")
    .replace(/ with time zone/gi, " tz")
    .replace(/character/gi, "char")
    .replace(/double precision/gi, "double")
    .trim();
}

/** Renders one SQL column header and subscribes only through its grid owner. */
export const TableViewColumnHeader = memo(function TableViewColumnHeader({
  column,
  columnType,
  index,
  isForeignKey,
  isPrimaryKey,
  onClearSort,
  onSort,
  resize,
  sort,
}: ColumnHeaderProps) {
  return (
    <th
      className="group/header relative sticky top-0 z-40 select-none overflow-hidden whitespace-nowrap border-border border-r bg-db-access-sticky-header-surface py-2 pr-0 pl-4 text-left font-medium text-muted-foreground text-sm"
      data-db-access-column={column}
      style={columnWidthStyle(column, index)}
    >
      <div className="relative z-10 flex h-full items-center justify-between">
        <div className="mr-10 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1">
            <span className="truncate text-foreground" title={column}>
              {column}
            </span>
            {isPrimaryKey && (
              <Badge
                className="h-4 shrink-0 bg-input/30 px-1 py-0 text-[10px]"
                variant="secondary"
              >
                PK
              </Badge>
            )}
            {isForeignKey && (
              <Badge
                className="h-4 shrink-0 border-primary/30 px-1 py-0 text-[10px] text-primary"
                variant="outline"
              >
                FK
              </Badge>
            )}
            {sort.column === column && (
              <span className="shrink-0 text-primary">
                {sort.direction === "asc" ? (
                  <ArrowUpAZ className="h-3 w-3" />
                ) : (
                  <ArrowDownAZ className="h-3 w-3" />
                )}
              </span>
            )}
          </div>
          {columnType && (
            <span className="truncate font-normal text-muted-foreground/80 text-xs normal-case">
              {simplifyColumnType(columnType)}
            </span>
          )}
        </div>
        <DataViewSortMenu
          align={index === 0 ? "start" : "end"}
          column={column}
          onClearSort={onClearSort}
          onSort={onSort}
          sortColumn={sort.column}
          sortDirection={sort.direction}
        />
      </div>

      <ColumnResizeHandle column={column} columnIndex={index} resize={resize} />
    </th>
  );
});
