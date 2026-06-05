import { FindBarContext } from "@data-browser/components/database/shared/FindBar.Provider";
import { cn } from "@data-browser/lib/utils";
import { EyeOff, Loader2 } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  use,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { TableViewColumnHeader } from "./TableView.ColumnHeader";
import { useTableView } from "./TableViewProvider";

/** Renders the SQL table data grid with row-number selection, cell editing, and pending-change states. */
export function TableViewDataGrid() {
  const { state, actions } = useTableView();
  const findBar = use(FindBarContext);

  const visibleColumns =
    state.data?.columns?.filter((col) => state.visibleColumns.includes(col)) ??
    [];
  const hiddenColumnCount = state.data?.columns
    ? state.data.columns.length - state.visibleColumns.length
    : 0;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [isScrolledX, setIsScrolledX] = useState(false);
  const [isScrolledY, setIsScrolledY] = useState(false);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      setIsScrolledX(el.scrollLeft > 0);
      setIsScrolledY(el.scrollTop > 0);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTypingTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        !isTypingTarget
      ) {
        event.preventDefault();
        actions.undoLastChange();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [actions.undoLastChange]);

  if (state.loading && !state.data) {
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

  function isEditableCell(
    _rowKey: string,
    column: string,
    isDeleted: boolean,
    isInserted: boolean
  ) {
    if (!state.canEdit || isDeleted) {
      return false;
    }
    if (isInserted) {
      return true;
    }
    if (state.primaryKey && column === state.primaryKey) {
      return false;
    }
    return true;
  }

  function handleCellKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
    rowKey: string,
    column: string
  ) {
    const isComposing = event.nativeEvent.isComposing || event.keyCode === 229;

    if (event.key === "Escape") {
      event.preventDefault();
      actions.deactivateCell();
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      actions.moveActiveCell(event.shiftKey ? "left" : "right");
      return;
    }

    if (event.key === "Enter") {
      if (isComposing) {
        return;
      }
      event.preventDefault();
      actions.moveActiveCell(event.shiftKey ? "up" : "down");
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      actions.deactivateCell();
      actions.undoLastChange();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      actions.deactivateCell();
      actions.setShowSubmitModal(true);
      return;
    }

    if (
      state.activeCell?.rowKey !== rowKey ||
      state.activeCell.column !== column
    ) {
      actions.activateCell(rowKey, column);
    }
  }

  return (
    <div
      className="flex-1 overflow-auto"
      data-qa-module="sql"
      data-qa-object="table-grid"
      data-qa-row-count={state.renderedRows.length}
      data-qa-state={state.renderedRows.length > 0 ? "ready" : "empty"}
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
        data-qa-state={state.renderedRows.length > 0 ? "ready" : "empty"}
        data-testid="sql.table.grid"
      >
        <thead className="border-border border-b bg-transparent">
          <tr>
            <th
              className="sticky top-0 left-0 z-50 overflow-hidden border-border border-r border-b bg-transparent px-2 py-2 text-center font-semibold text-muted-foreground text-xs"
              style={{ width: 48, minWidth: 48, maxWidth: 48 }}
            >
              <div className="pointer-events-none absolute inset-0 bg-input/30 backdrop-blur-lg" />
            </th>
            {visibleColumns.map((col, idx) => (
              <TableViewColumnHeader column={col} index={idx} key={col} />
            ))}
            {hiddenColumnCount > 0 && (
              <th
                className="sticky top-0 z-40 overflow-hidden border-border border-b bg-transparent px-4 py-2 text-center font-medium text-muted-foreground text-xs"
                title={`${hiddenColumnCount} hidden column(s)`}
              >
                <div className="pointer-events-none absolute inset-0 bg-input/30 backdrop-blur-lg" />
                <div className="relative z-10 flex items-center justify-center gap-1">
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>{hiddenColumnCount}</span>
                </div>
              </th>
            )}
            <th className="sticky top-0 z-40 w-full overflow-hidden border-border border-b bg-transparent">
              <div className="pointer-events-none absolute inset-0 bg-input/30 backdrop-blur-lg" />
            </th>
          </tr>
        </thead>
        <tbody className="bg-transparent">
          {state.renderedRows.map((row, rowIdx) => {
            const isSelected = state.selectedRowKeys.has(row.rowKey);

            return (
              <tr
                className={cn(
                  "group transition-colors",
                  row.isInserted && "bg-blue-100/20",
                  row.isDeleted && "bg-red-100/20",
                  !(row.isInserted || row.isDeleted) && "hover:bg-input/30"
                )}
                data-qa-module="sql"
                data-qa-object="table-row"
                data-qa-resource-id={row.rowKey}
                data-qa-resource-type="table-row"
                data-qa-state={
                  row.isInserted
                    ? "inserted"
                    : row.isDeleted
                      ? "deleted"
                      : isSelected
                        ? "selected"
                        : "ready"
                }
                data-testid="sql.table.row"
                key={row.rowKey}
              >
                <td
                  className={cn(
                    "sticky left-0 z-30 border-border border-r border-b bg-[#0C1120] px-2 py-2 text-center font-normal text-sm",
                    row.isInserted && "bg-blue-100/60",
                    row.isDeleted &&
                      "bg-red-100/60 text-muted-foreground line-through",
                    isSelected && "bg-primary/10"
                  )}
                  data-qa-action="select"
                  data-qa-disabled-reason={
                    state.canEdit ? undefined : "read_only"
                  }
                  data-qa-module="sql"
                  data-qa-object="table-row"
                  data-qa-resource-id={row.rowKey}
                  data-qa-resource-type="table-row"
                  data-qa-state={isSelected ? "selected" : "ready"}
                  data-testid="sql.table.row-selector"
                  onClick={() => {
                    if (state.canEdit) {
                      actions.toggleRowSelection(row.rowKey);
                    }
                  }}
                  style={{ width: 48, minWidth: 48, maxWidth: 48 }}
                >
                  {row.rowNumber ?? ""}
                </td>

                {visibleColumns.map((col) => {
                  const width = state.columnWidths[col] || 120;
                  const isActiveCell =
                    state.activeCell?.rowKey === row.rowKey &&
                    state.activeCell.column === col;
                  const editable = isEditableCell(
                    row.rowKey,
                    col,
                    row.isDeleted,
                    row.isInserted
                  );
                  const changed =
                    row.changeType === "update" &&
                    row.originalRow[col] !== row.values[col];
                  const highlight = findBar?.state.total
                    ? findBar.state.matches.findIndex(
                        (match) =>
                          match.rowIndex === rowIdx && match.columnKey === col
                      ) === findBar.state.currentMatchIndex
                      ? "current"
                      : findBar.state.matches.some(
                            (match) =>
                              match.rowIndex === rowIdx &&
                              match.columnKey === col
                          )
                        ? "match"
                        : null
                    : null;
                  const displayValue = row.values[col];

                  return (
                    <td
                      className={cn(
                        "relative scroll-mt-14 overflow-hidden border-border border-r border-b text-foreground/80 text-sm",
                        isActiveCell ? "p-0" : "px-6 py-2",
                        row.isInserted && "bg-blue-100/60",
                        row.isDeleted &&
                          "bg-red-100/60 text-muted-foreground line-through",
                        changed && "bg-green-100/60",
                        isSelected &&
                          !row.isInserted &&
                          !row.isDeleted &&
                          !changed &&
                          "bg-primary/10",
                        highlight === "current" && "bg-input",
                        highlight === "match" && "bg-input/30",
                        editable && !isActiveCell && "cursor-default"
                      )}
                      data-find-current={
                        highlight === "current" ? "true" : undefined
                      }
                      data-qa-disabled-reason={
                        editable
                          ? undefined
                          : row.isDeleted
                            ? "row_deleted"
                            : state.primaryKey && col === state.primaryKey
                              ? "primary_key"
                              : state.canEdit
                                ? undefined
                                : "read_only"
                      }
                      data-qa-field={col}
                      data-qa-module="sql"
                      data-qa-object="table-cell"
                      data-qa-resource-id={row.rowKey}
                      data-qa-resource-type="table-row"
                      data-qa-state={
                        isActiveCell
                          ? "editing"
                          : changed
                            ? "changed"
                            : row.isInserted
                              ? "inserted"
                              : row.isDeleted
                                ? "deleted"
                                : editable
                                  ? "editable"
                                  : "read_only"
                      }
                      data-testid="sql.table.cell"
                      key={col}
                      onDoubleClick={() => {
                        if (editable) {
                          actions.activateCell(row.rowKey, col);
                        }
                      }}
                      style={{
                        minWidth: `${width}px`,
                        ...(state.resizedColumns.has(col) && {
                          maxWidth: `${width}px`,
                        }),
                      }}
                    >
                      {isActiveCell ? (
                        <input
                          autoFocus
                          className="min-h-[36px] w-full bg-transparent px-6 py-2 text-sm focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:ring-inset"
                          data-changeset-editor="true"
                          data-qa-action="edit"
                          data-qa-field={col}
                          data-qa-module="sql"
                          data-qa-object="table-cell"
                          data-qa-resource-id={row.rowKey}
                          data-qa-resource-type="table-row"
                          data-qa-state="editing"
                          data-testid="sql.table.cell-editor"
                          onBlur={() => {
                            queueMicrotask(() => {
                              const activeElement = document.activeElement;
                              if (
                                activeElement instanceof HTMLInputElement &&
                                activeElement.dataset.changesetEditor === "true"
                              ) {
                                return;
                              }
                              actions.deactivateCell();
                            });
                          }}
                          onChange={(event) =>
                            actions.updateActiveCellValue(event.target.value)
                          }
                          onKeyDown={(event) =>
                            handleCellKeyDown(event, row.rowKey, col)
                          }
                          type="text"
                          value={state.activeDraftValue}
                        />
                      ) : (
                        <span
                          className="block truncate"
                          title={displayValue ?? "NULL"}
                        >
                          {displayValue == null ? (
                            <span className="text-muted-foreground italic">
                              NULL
                            </span>
                          ) : (
                            String(displayValue)
                          )}
                        </span>
                      )}
                      <div
                        className={cn(
                          "absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize data-[resize-active]:bg-primary/50",
                          state.resizingColumn === col && "bg-primary/50"
                        )}
                        data-resize-col={col}
                        onMouseDown={(e) => actions.handleResizeStart(e, col)}
                        onMouseEnter={() => {
                          if (state.resizingColumn) {
                            return;
                          }
                          document
                            .querySelectorAll<HTMLElement>(
                              `[data-resize-col="${col}"]`
                            )
                            .forEach((el) => {
                              el.dataset.resizeActive = "";
                            });
                        }}
                        onMouseLeave={() => {
                          if (state.resizingColumn) {
                            return;
                          }
                          document
                            .querySelectorAll<HTMLElement>(
                              `[data-resize-col="${col}"]`
                            )
                            .forEach((el) => {
                              delete el.dataset.resizeActive;
                            });
                        }}
                      />
                    </td>
                  );
                })}

                {hiddenColumnCount > 0 && (
                  <td className="border-border border-b bg-transparent" />
                )}
                <td className="w-full border-border border-b bg-transparent" />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
