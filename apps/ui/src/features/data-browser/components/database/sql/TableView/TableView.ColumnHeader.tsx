import {
  type DataViewSortDirection,
  DataViewSortMenu,
} from "@data-browser/components/database/shared/DataViewSortMenu";
import type { DbAccessSortState } from "@data-browser/state/db-access-view-state";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";

interface ColumnHeaderProps {
  column: string;
  columnType?: string;
  index: number;
  isForeignKey: boolean;
  isPrimaryKey: boolean;
  onClearSort: () => void;
  onResizeHandleEnter: (column: string) => void;
  onResizeHandleLeave: (column: string) => void;
  onResizeStart: (event: React.MouseEvent, column: string) => void;
  onSort: (column: string, direction: DataViewSortDirection) => void;
  resized: boolean;
  sort: DbAccessSortState;
  width: number;
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
export function TableViewColumnHeader({
  column,
  columnType,
  index,
  isForeignKey,
  isPrimaryKey,
  onClearSort,
  onResizeHandleEnter,
  onResizeHandleLeave,
  onResizeStart,
  onSort,
  resized,
  sort,
  width,
}: ColumnHeaderProps) {
  return (
    <th
      className="group/header relative sticky top-0 z-40 select-none overflow-hidden whitespace-nowrap border-border border-r bg-transparent py-2 pr-0 pl-4 text-left font-medium text-muted-foreground text-sm"
      data-db-access-column={column}
      style={{
        minWidth: `${width}px`,
        ...(resized && { maxWidth: `${width}px` }),
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-input/30 backdrop-blur-lg" />
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

      <div
        className="absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize data-[resize-active]:bg-primary/50"
        data-db-access-resize-handle={column}
        onMouseDown={(event) => onResizeStart(event, column)}
        onMouseEnter={() => onResizeHandleEnter(column)}
        onMouseLeave={() => onResizeHandleLeave(column)}
      />
    </th>
  );
}
