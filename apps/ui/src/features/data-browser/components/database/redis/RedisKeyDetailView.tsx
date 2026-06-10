import {
  accessRowsToDataFlowTableData,
  getRows,
} from "@data-browser/api/access-adapter";
import type {
  AccessObjectRef,
  AccessRowsSort,
  DataFlowTableData,
} from "@data-browser/api/access-types";
import { DataView } from "@data-browser/components/database/shared/DataView";
import {
  FindBar,
  useFindBar,
} from "@data-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@data-browser/components/database/shared/SingleObjectExportModal";
import {
  useDbAccessRefresh,
  useDbAccessRuntime,
} from "@data-browser/state/db-access-session";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

type RedisKeyType = "string" | "hash" | "list" | "set" | "zset";

function detectRedisKeyType(
  columns: string[],
  disableUpdate: boolean
): RedisKeyType {
  if (columns.includes("field")) {
    return "hash";
  }
  if (columns.includes("member")) {
    return "zset";
  }
  if (columns.includes("index")) {
    return disableUpdate ? "set" : "list";
  }
  return "string";
}

/** Render-prop consumer for FindBar context — allows inline access to find state. */
function FindBarConsumer({
  children,
}: {
  children: (state: ReturnType<typeof useFindBar>["state"]) => ReactNode;
}) {
  const { state } = useFindBar();
  return <>{children(state)}</>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RedisKeyDetailViewProps {
  databaseName: string;
  dbServiceKey: string;
  keyName: string;
  objectRef: AccessObjectRef;
}

/** Displays a single Redis key's contents in the read-only DB Access surface. */
export function RedisKeyDetailView({
  databaseName,
  dbServiceKey,
  keyName,
  objectRef,
}: RedisKeyDetailViewProps) {
  const runtime = useDbAccessRuntime();
  const { tableRefreshKey } = useDbAccessRefresh();

  // ---- Data state ----
  const [data, setData] = useState<DataFlowTableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- Derived ----
  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const disableUpdate = data?.disableUpdate ?? false;
  const keyType =
    columns.length > 0 ? detectRedisKeyType(columns, disableUpdate) : "string";

  // ---- Pagination ----
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const totalPages = Math.ceil(total / pageSize);

  // ---- Sort ----
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(
    null
  );
  const [activeColumnMenu, setActiveColumnMenu] = useState<string | null>(null);

  // ---- Column resize ----
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizedColumns, setResizedColumns] = useState<Set<string>>(new Set());
  const resizingRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  // ---- Export state ----
  const [showExport, setShowExport] = useState(false);

  // ---- Ref for race-condition prevention ----
  const latestRequestIdRef = useRef(0);

  // =========================================================================
  // Data fetching
  // =========================================================================

  const fetchData = useCallback(async () => {
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
        sort,
        pageSize,
        pageOffset: (currentPage - 1) * pageSize,
      });

      if (thisRequestId !== latestRequestIdRef.current) {
        return;
      }

      const tableData = accessRowsToDataFlowTableData(result);
      setData(tableData);

      // Initialize column widths on first load
      if (Object.keys(columnWidths).length === 0) {
        const widths: Record<string, number> = {};
        tableData.columns.forEach((col) => {
          widths[col] = Math.max(120, col.length * 10 + 60);
        });
        setColumnWidths(widths);
      }
    } catch (err) {
      if (thisRequestId !== latestRequestIdRef.current) {
        return;
      }
      const message = err instanceof Error ? err.message.trim() : "";
      setError(message || "Failed to fetch Redis key");
    } finally {
      if (thisRequestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [runtime, sortColumn, sortDirection, pageSize, currentPage, objectRef]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey, tableRefreshKey]);

  const refresh = useCallback(() => {
    setRefreshKey((key) => key + 1);
  }, []);

  // =========================================================================
  // Column resize (copied pattern from SQL TableView)
  // =========================================================================

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) {
        return;
      }
      const { column, startX, startWidth } = resizingRef.current;
      const newWidth = Math.max(60, startWidth + (e.clientX - startX));
      document
        .querySelectorAll<HTMLElement>(`[data-col="${column}"]`)
        .forEach((el) => {
          el.style.minWidth = `${newWidth}px`;
          el.style.maxWidth = `${newWidth}px`;
        });
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (!resizingRef.current) {
        return;
      }
      const { column, startX, startWidth } = resizingRef.current;
      const finalWidth = Math.max(60, startWidth + (e.clientX - startX));
      setColumnWidths((prev) => ({ ...prev, [column]: finalWidth }));
      setResizedColumns((prev) => {
        if (prev.has(column)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(column);
        return next;
      });
      resizingRef.current = null;
      setResizingColumn(null);
      document.body.style.cursor = "default";
      document
        .querySelectorAll<HTMLElement>("[data-resize-active]")
        .forEach((el) => {
          delete el.dataset.resizeActive;
        });
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, column: string) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = {
        column,
        startX: e.clientX,
        startWidth: columnWidths[column] || 120,
      };
      setResizingColumn(column);
      document.body.style.cursor = "col-resize";
    },
    [columnWidths]
  );

  // =========================================================================
  // Sort handlers
  // =========================================================================

  const handleSort = useCallback((col: string, dir: "asc" | "desc") => {
    setSortColumn(col);
    setSortDirection(dir);
    setCurrentPage(1);
    setActiveColumnMenu(null);
  }, []);

  const clearSort = useCallback(() => {
    setSortColumn(null);
    setSortDirection(null);
    setCurrentPage(1);
    setActiveColumnMenu(null);
  }, []);

  // =========================================================================
  // Pagination handlers
  // =========================================================================

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);
  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  }, []);

  // =========================================================================
  // Scroll shadow tracking
  // =========================================================================

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

  // =========================================================================
  // Render
  // =========================================================================

  if (loading && !data) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-qa-database={databaseName}
        data-qa-db-service-key={dbServiceKey}
        data-qa-loading="true"
        data-qa-module="redis"
        data-qa-object="key-detail"
        data-qa-resource-id={keyName}
        data-qa-resource-type="redis_key"
        data-qa-state="loading"
        data-testid="redis.key.detail-loading"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <FindBar.Provider columns={columns} rows={rows}>
      <div
        className="flex h-full flex-col bg-background"
        data-qa-database={databaseName}
        data-qa-db-service-key={dbServiceKey}
        data-qa-key-type={keyType}
        data-qa-loading={loading ? "true" : "false"}
        data-qa-module="redis"
        data-qa-object="key-detail"
        data-qa-resource-id={keyName}
        data-qa-resource-type="redis_key"
        data-qa-state={error ? "error" : loading ? "loading" : "ready"}
        data-testid="redis.key.detail"
      >
        {/* ---- Toolbar ---- */}
        <div
          className="flex h-12 items-center justify-between px-2"
          data-qa-module="redis"
          data-qa-object="key-toolbar"
          data-qa-state={loading ? "loading" : "ready"}
          data-testid="redis.key.toolbar"
        >
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <AppIconButton
                    aria-label="Refresh"
                    data-qa-action="refresh"
                    data-qa-disabled-reason={loading ? "loading" : undefined}
                    data-qa-module="redis"
                    data-qa-object="key-data"
                    data-qa-state={loading ? "loading" : "ready"}
                    data-testid="redis.key.refresh-button"
                    disabled={loading}
                    onClick={refresh}
                    size="md"
                    variant="quiet"
                  >
                    <RefreshCw
                      className={cn("h-4 w-4", loading && "animate-spin")}
                    />
                  </AppIconButton>
                }
              />
              <TooltipContent>{"Refresh"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <AppIconButton
                    aria-label="Export"
                    data-qa-action="export"
                    data-qa-module="redis"
                    data-qa-object="key-data"
                    data-testid="redis.key.export-button"
                    onClick={() => setShowExport(true)}
                    size="md"
                    variant="quiet"
                  >
                    <Download className="h-4 w-4" />
                  </AppIconButton>
                }
              />
              <TooltipContent>{"Export"}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <FindBar.Bar />

        {/* ---- Error banner ---- */}
        {error && (
          <div
            className="flex items-center justify-between border-destructive/20 border-b bg-destructive/10 px-4 py-2 text-destructive text-sm"
            data-qa-error-code="redis_key_operation_failed"
            data-qa-module="redis"
            data-qa-object="key-data"
            data-qa-state="error"
            data-testid="redis.key.error"
          >
            <span>{error}</span>
            <AppIconButton
              aria-label="Dismiss error"
              onClick={() => setError(null)}
              size="sm"
              variant="quiet"
            >
              <X className="h-3 w-3" />
            </AppIconButton>
          </div>
        )}

        {/* ---- Data grid ---- */}
        <div
          className="flex-1 overflow-auto"
          data-qa-module="redis"
          data-qa-object="key-grid"
          data-qa-row-count={rows.length}
          data-qa-state={rows.length > 0 ? "ready" : "empty"}
          data-scrolled-x={isScrolledX || undefined}
          data-scrolled-y={isScrolledY || undefined}
          data-testid="redis.key.grid-scroll"
          onScroll={handleScroll}
          ref={scrollRef}
        >
          <table
            className="min-w-full border-collapse text-sm"
            data-qa-module="redis"
            data-qa-object="key-grid"
            data-qa-state={rows.length > 0 ? "ready" : "empty"}
            data-testid="redis.key.grid"
          >
            <thead className="border-border border-b bg-background">
              <tr>
                {/* Row number column */}
                <th
                  className="sticky top-0 left-0 z-50 border-border/50 border-r border-b bg-background px-2 py-2 text-center font-semibold text-muted-foreground text-xs"
                  style={{ width: 64, minWidth: 64, maxWidth: 64 }}
                >
                  {" "}
                </th>

                {/* Data columns */}
                {columns.map((col, colIdx) => {
                  const width = columnWidths[col] || 120;
                  return (
                    <th
                      className="group/header relative sticky top-0 z-40 select-none overflow-hidden whitespace-nowrap border-border/50 border-r bg-background px-6 py-2 text-left font-medium text-muted-foreground text-sm"
                      data-col={col}
                      key={col}
                      style={{
                        minWidth: `${width}px`,
                        ...(resizedColumns.has(col) && {
                          maxWidth: `${width}px`,
                        }),
                      }}
                    >
                      <div className="flex h-full items-center justify-between">
                        <div className="mr-6 flex items-center gap-1 overflow-hidden">
                          <span className="truncate" title={col}>
                            {col}
                          </span>
                          {sortColumn === col && (
                            <span className="shrink-0 text-primary">
                              {sortDirection === "asc" ? (
                                <ArrowUpAZ className="h-3 w-3" />
                              ) : (
                                <ArrowDownAZ className="h-3 w-3" />
                              )}
                            </span>
                          )}
                        </div>

                        {/* Sort menu */}
                        <DropdownMenu
                          onOpenChange={(open) =>
                            setActiveColumnMenu(open ? col : null)
                          }
                          open={activeColumnMenu === col}
                        >
                          <DropdownMenuTrigger
                            render={
                              <AppIconButton
                                aria-label="Column actions"
                                className={cn(
                                  "absolute top-2 right-2 text-muted-foreground",
                                  activeColumnMenu === col &&
                                    "bg-muted text-foreground"
                                )}
                                onClick={(e) => e.stopPropagation()}
                                size="sm"
                                variant="quiet"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </AppIconButton>
                            }
                          />
                          <DropdownMenuContent
                            align={colIdx === 0 ? "start" : "end"}
                            className="w-40"
                          >
                            <DropdownMenuGroup>
                              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                                {"Sort actions"}
                              </DropdownMenuLabel>
                              <DropdownMenuItem
                                className={cn(
                                  sortColumn === col &&
                                    sortDirection === "asc" &&
                                    "bg-primary/5 font-medium text-primary"
                                )}
                                onClick={() => handleSort(col, "asc")}
                              >
                                <ArrowUpAZ className="h-3.5 w-3.5" />
                                {"Sort ascending"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className={cn(
                                  sortColumn === col &&
                                    sortDirection === "desc" &&
                                    "bg-primary/5 font-medium text-primary"
                                )}
                                onClick={() => handleSort(col, "desc")}
                              >
                                <ArrowDownAZ className="h-3.5 w-3.5" />
                                {"Sort descending"}
                              </DropdownMenuItem>
                              {sortColumn === col && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={clearSort}>
                                    <X className="h-3.5 w-3.5" />
                                    {"Clear sort"}
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>

                      {/* Resize handle */}
                      <div
                        className={cn(
                          "absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize data-[resize-active]:bg-primary/50",
                          resizingColumn === col && "bg-primary/50"
                        )}
                        data-resize-col={col}
                        onMouseDown={(e) => handleResizeStart(e, col)}
                        onMouseEnter={() => {
                          if (!resizingColumn) {
                            document
                              .querySelectorAll<HTMLElement>(
                                `[data-resize-col="${col}"]`
                              )
                              .forEach((el) => {
                                el.dataset.resizeActive = "";
                              });
                          }
                        }}
                        onMouseLeave={() => {
                          if (!resizingColumn) {
                            document
                              .querySelectorAll<HTMLElement>(
                                `[data-resize-col="${col}"]`
                              )
                              .forEach((el) => {
                                delete el.dataset.resizeActive;
                              });
                          }
                        }}
                      />
                    </th>
                  );
                })}

                <th className="sticky top-0 z-40 w-full border-border/50 border-b bg-background" />
              </tr>
            </thead>
            <FindBarConsumer>
              {(findState) => (
                <tbody className="bg-background">
                  {rows.map((row, rowIdx) => {
                    return (
                      <tr
                        className="group transition-colors hover:bg-input/30"
                        data-qa-module="redis"
                        data-qa-object="key-row"
                        data-qa-resource-id={`${keyName}:${rowIdx}`}
                        data-qa-resource-type="redis_key_row"
                        data-qa-state="ready"
                        data-testid="redis.key.row"
                        key={rowIdx}
                      >
                        {/* Row number — click to toggle selection */}
                        <td
                          className={cn(
                            "sticky left-0 z-30 border-border/50 border-r border-b bg-background px-2 py-2 text-center font-medium text-xs"
                          )}
                          data-qa-disabled-reason="read_only"
                          data-qa-module="redis"
                          data-qa-object="key-row"
                          data-qa-resource-id={`${keyName}:${rowIdx}`}
                          data-qa-resource-type="redis_key_row"
                          data-qa-state="ready"
                          data-testid="redis.key.row-selector"
                          style={{ width: 64, minWidth: 64, maxWidth: 64 }}
                        >
                          {(currentPage - 1) * pageSize + rowIdx + 1}
                        </td>

                        {/* Data cells */}
                        {columns.map((col) => {
                          const width = columnWidths[col] || 120;
                          const highlight = findState.total
                            ? findState.matches.findIndex(
                                (m) =>
                                  m.rowIndex === rowIdx && m.columnKey === col
                              ) === findState.currentMatchIndex
                              ? "current"
                              : findState.matches.some(
                                    (m) =>
                                      m.rowIndex === rowIdx &&
                                      m.columnKey === col
                                  )
                                ? "match"
                                : null
                            : null;

                          return (
                            <td
                              className={cn(
                                "relative scroll-mt-14 overflow-hidden border-border/50 border-r border-b text-foreground/80 text-sm",
                                "px-6 py-2",
                                highlight === "current" && "bg-input",
                                highlight === "match" && "bg-input/30"
                              )}
                              data-col={col}
                              data-find-current={
                                highlight === "current" ? "true" : undefined
                              }
                              data-qa-disabled-reason="read_only"
                              data-qa-field={col}
                              data-qa-module="redis"
                              data-qa-object="key-cell"
                              data-qa-resource-id={`${keyName}:${rowIdx}`}
                              data-qa-resource-type="redis_key_row"
                              data-qa-state="read_only"
                              data-testid="redis.key.cell"
                              key={col}
                              style={{
                                minWidth: `${width}px`,
                                ...(resizedColumns.has(col) && {
                                  maxWidth: `${width}px`,
                                }),
                              }}
                            >
                              <span
                                className="block truncate"
                                title={row[col] ?? ""}
                              >
                                {row[col] ?? ""}
                              </span>

                              {/* Resize guide on cells */}
                              <div
                                className={cn(
                                  "absolute top-0 right-0 -bottom-px z-20 w-1 cursor-col-resize data-[resize-active]:bg-primary/50",
                                  resizingColumn === col && "bg-primary/50"
                                )}
                                data-resize-col={col}
                                onMouseDown={(e) => handleResizeStart(e, col)}
                                onMouseEnter={() => {
                                  if (!resizingColumn) {
                                    document
                                      .querySelectorAll<HTMLElement>(
                                        `[data-resize-col="${col}"]`
                                      )
                                      .forEach((el) => {
                                        el.dataset.resizeActive = "";
                                      });
                                  }
                                }}
                                onMouseLeave={() => {
                                  if (!resizingColumn) {
                                    document
                                      .querySelectorAll<HTMLElement>(
                                        `[data-resize-col="${col}"]`
                                      )
                                      .forEach((el) => {
                                        delete el.dataset.resizeActive;
                                      });
                                  }
                                }}
                              />
                            </td>
                          );
                        })}

                        <td className="w-full border-border/50 border-b bg-background" />
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </FindBarConsumer>
          </table>

          {rows.length === 0 && (
            <div
              className="flex items-center justify-center py-12 text-muted-foreground text-sm"
              data-qa-module="redis"
              data-qa-object="key-grid"
              data-qa-state="empty"
              data-testid="redis.key.empty"
            >
              {"No values found"}
            </div>
          )}
        </div>

        {/* ---- Pagination ---- */}
        {total > 0 && (
          <DataView.Pagination
            currentPage={currentPage}
            loading={loading}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
          />
        )}

        <SingleObjectExportModal
          objectRef={objectRef}
          onOpenChange={setShowExport}
          open={showExport}
          title={keyName}
        />
      </div>
    </FindBar.Provider>
  );
}
