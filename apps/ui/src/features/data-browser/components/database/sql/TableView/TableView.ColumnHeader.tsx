import { DataViewSortMenu } from "@data-browser/components/database/shared/DataViewSortMenu";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowDownAZ, ArrowUpAZ } from "lucide-react";
import { simplifyColumnType, useTableView } from "./TableViewProvider";

interface ColumnHeaderProps {
  column: string;
  index: number;
}

/** Renders a single column header `<th>` with type badge, sort indicator, menu dropdown, and resize handle. */
export function TableViewColumnHeader({ column, index }: ColumnHeaderProps) {
  const { state, actions } = useTableView();
  const width = state.columnWidths[column] || 120;

  return (
    <th
      className="group/header relative sticky top-0 z-40 select-none overflow-hidden whitespace-nowrap border-border border-r bg-transparent py-2 pr-0 pl-4 text-left font-medium text-muted-foreground text-sm"
      style={{
        minWidth: `${width}px`,
        ...(state.resizedColumns.has(column) && { maxWidth: `${width}px` }),
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-input/30 backdrop-blur-lg" />
      <div className="relative z-10 flex h-full items-center justify-between">
        <div className="mr-10 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1">
            <span className="truncate" title={column}>
              {column}
            </span>
            {column === state.primaryKey && (
              <Badge
                className="h-4 shrink-0 px-1 py-0 text-[10px]"
                variant="secondary"
              >
                PK
              </Badge>
            )}
            {state.foreignKeyColumns.includes(column) && (
              <Badge
                className="h-4 shrink-0 border-primary/30 px-1 py-0 text-[10px] text-primary"
                variant="outline"
              >
                FK
              </Badge>
            )}
            {state.sortColumn === column && (
              <span className="shrink-0 text-primary">
                {state.sortDirection === "asc" ? (
                  <ArrowUpAZ className="h-3 w-3" />
                ) : (
                  <ArrowDownAZ className="h-3 w-3" />
                )}
              </span>
            )}
          </div>
          {state.data?.columnTypes?.[column] && (
            <span className="truncate font-normal text-muted-foreground/80 text-xs normal-case">
              {simplifyColumnType(state.data.columnTypes[column])}
            </span>
          )}
        </div>
        <DataViewSortMenu
          align={index === 0 ? "start" : "end"}
          column={column}
          onClearSort={actions.clearSort}
          onOpenChange={(open) =>
            actions.setActiveColumnMenu(open ? column : null)
          }
          onSort={actions.handleSort}
          open={state.activeColumnMenu === column}
          sortColumn={state.sortColumn}
          sortDirection={state.sortDirection}
        />
      </div>

      {/* Resize Handle */}
      <div
        className={cn(
          "absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize data-[resize-active]:bg-primary/50",
          state.resizingColumn === column && "bg-primary/50"
        )}
        data-resize-col={column}
        onMouseDown={(e) => actions.handleResizeStart(e, column)}
        onMouseEnter={() => {
          if (state.resizingColumn) {
            return;
          }
          document
            .querySelectorAll<HTMLElement>(`[data-resize-col="${column}"]`)
            .forEach((el) => {
              el.dataset.resizeActive = "";
            });
        }}
        onMouseLeave={() => {
          if (state.resizingColumn) {
            return;
          }
          document
            .querySelectorAll<HTMLElement>(`[data-resize-col="${column}"]`)
            .forEach((el) => {
              delete el.dataset.resizeActive;
            });
        }}
      />
    </th>
  );
}
