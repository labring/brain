import {
  accessRowsToDataFlowTableData,
  getRows,
} from "@db-browser/api/access-adapter";
import type {
  AccessObjectRef,
  AccessRowsSort,
  DataFlowTableData,
} from "@db-browser/api/access-types";
import { ColumnResizeGuide } from "@db-browser/components/database/shared/ColumnResizeGuide";
import { ColumnResizeHandle } from "@db-browser/components/database/shared/ColumnResizeHandle";
import { DataView } from "@db-browser/components/database/shared/DataView";
import { DataViewSortMenu } from "@db-browser/components/database/shared/DataViewSortMenu";
import {
  FindBar,
  type FindHighlight,
  findCellHighlight,
  useFindInView,
} from "@db-browser/components/database/shared/FindBar";
import { SingleObjectExportModal } from "@db-browser/components/database/shared/SingleObjectExportModal";
import {
  columnWidthStyle,
  useColumnResize,
} from "@db-browser/components/database/shared/useColumnResize";
import { useDbAccessRuntime } from "@db-browser/state/db-access-session";
import {
  type DbAccessSortState,
  useDbAccessViewState,
} from "@db-browser/state/db-access-view-state";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Download,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type RedisKeyType = "string" | "hash" | "list" | "set" | "zset";

interface RedisKeyDetailViewProps {
  active: boolean;
  databaseName: string;
  dbServiceKey: string;
  keyName: string;
  objectRef: AccessObjectRef;
  viewKey: string;
}

interface UseRedisKeyQueryParams {
  currentPage: number;
  objectRef: AccessObjectRef;
  pageSize: number;
  sort: DbAccessSortState;
  viewKey: string;
}

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

function useRedisKeyQuery({
  currentPage,
  objectRef,
  pageSize,
  sort,
  viewKey,
}: UseRedisKeyQueryParams) {
  const runtime = useDbAccessRuntime();
  const viewState = useDbAccessViewState(viewKey);
  const refreshVersion = useAtomValue(viewState.refreshVersionAtom);
  const refresh = useSetAtom(viewState.triggerRefreshAtom);
  const [data, setData] = useState<DataFlowTableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latestRequestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    latestRequestIdRef.current += 1;
    const requestId = latestRequestIdRef.current;
    const querySort: AccessRowsSort[] | undefined =
      sort.column && sort.direction
        ? [
            {
              column: sort.column,
              direction: sort.direction === "asc" ? "ASC" : "DESC",
            },
          ]
        : undefined;

    try {
      const result = await getRows({
        pageOffset: (currentPage - 1) * pageSize,
        pageSize,
        ref: objectRef,
        runtime,
        sort: querySort,
      });
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      setData(accessRowsToDataFlowTableData(result));
    } catch (caught) {
      if (requestId !== latestRequestIdRef.current) {
        return;
      }
      const message = caught instanceof Error ? caught.message.trim() : "";
      setError(message || "Failed to fetch Redis key");
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [currentPage, objectRef, pageSize, runtime, sort.column, sort.direction]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        fetchData();
      }
    });
    return () => {
      active = false;
    };
  }, [fetchData, refreshVersion]);

  return {
    data,
    dismissError: () => setError(null),
    error,
    loading,
    refresh,
  };
}

const RedisKeyToolbar = memo(function RedisKeyToolbar({
  keyName,
  loading,
  objectRef,
  onRefresh,
}: {
  keyName: string;
  loading: boolean;
  objectRef: AccessObjectRef;
  onRefresh: () => void;
}) {
  const [showExport, setShowExport] = useState(false);

  return (
    <>
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
                  onClick={onRefresh}
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

      <SingleObjectExportModal
        objectRef={objectRef}
        onOpenChange={setShowExport}
        open={showExport}
        title={keyName}
      />
    </>
  );
});

const RedisColumnHeader = memo(function RedisColumnHeader({
  column,
  columnIndex,
  onClearSort,
  onSort,
  resize,
  sort,
}: {
  column: string;
  columnIndex: number;
  onClearSort: () => void;
  onSort: (column: string, direction: "asc" | "desc") => void;
  resize: ReturnType<typeof useColumnResize>;
  sort: DbAccessSortState;
}) {
  return (
    <th
      className="group/header relative sticky top-0 z-40 select-none overflow-hidden whitespace-nowrap border-border/50 border-r bg-background px-6 py-2 text-left font-medium text-muted-foreground text-sm"
      data-db-access-column={column}
      style={columnWidthStyle(column, columnIndex)}
    >
      <div className="flex h-full items-center justify-between">
        <div className="mr-6 flex items-center gap-1 overflow-hidden">
          <span className="truncate" title={column}>
            {column}
          </span>
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

        <DataViewSortMenu
          align={columnIndex === 0 ? "start" : "end"}
          column={column}
          onClearSort={onClearSort}
          onSort={onSort}
          sortColumn={sort.column}
          sortDirection={sort.direction}
        />
      </div>

      <ColumnResizeHandle
        column={column}
        columnIndex={columnIndex}
        resize={resize}
      />
    </th>
  );
});

const RedisDataCell = memo(function RedisDataCell({
  column,
  columnIndex,
  highlight,
  keyName,
  resize,
  rowIndex,
  targetId,
  value,
}: {
  column: string;
  columnIndex: number;
  highlight: FindHighlight;
  keyName: string;
  resize: ReturnType<typeof useColumnResize>;
  rowIndex: number;
  targetId: string;
  value: string | null;
}) {
  return (
    <td
      className={cn(
        "relative scroll-mt-14 overflow-hidden border-border/50 border-r border-b text-foreground/80 text-sm",
        "px-6 py-2",
        highlight === "current" && "bg-input",
        highlight === "match" && "bg-input/30"
      )}
      data-db-access-column={column}
      data-find-current={highlight === "current" ? "true" : undefined}
      data-qa-disabled-reason="read_only"
      data-qa-field={column}
      data-qa-module="redis"
      data-qa-object="key-cell"
      data-qa-resource-id={`${keyName}:${rowIndex}`}
      data-qa-resource-type="redis_key_row"
      data-qa-state="read_only"
      data-testid="redis.key.cell"
      id={targetId}
      style={columnWidthStyle(column, columnIndex)}
    >
      <span className="block truncate" title={value ?? ""}>
        {value ?? ""}
      </span>
      <ColumnResizeHandle
        column={column}
        columnIndex={columnIndex}
        resize={resize}
      />
    </td>
  );
});

function RedisFindRegion({
  active,
  columns,
  currentPage,
  error,
  keyName,
  onClearSort,
  onDismissError,
  onSort,
  pageSize,
  resize,
  rootRef,
  rows,
  sort,
  viewKey,
}: {
  active: boolean;
  columns: string[];
  currentPage: number;
  error: string | null;
  keyName: string;
  onClearSort: () => void;
  onDismissError: () => void;
  onSort: (column: string, direction: "asc" | "desc") => void;
  pageSize: number;
  resize: ReturnType<typeof useColumnResize>;
  rootRef: RefObject<HTMLDivElement | null>;
  rows: Array<Record<string, string | null>>;
  sort: DbAccessSortState;
  viewKey: string;
}) {
  const find = useFindInView({ active, columns, rootRef, rows, viewKey });
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

  return (
    <>
      <FindBar.Bar find={find} />

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
            onClick={onDismissError}
            size="sm"
            variant="quiet"
          >
            <X className="h-3 w-3" />
          </AppIconButton>
        </div>
      )}

      <div
        className="flex-1 overflow-auto"
        data-db-access-grid-scroll=""
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
              <th
                className="sticky top-0 left-0 z-50 border-border/50 border-r border-b bg-background px-2 py-2 text-center font-semibold text-muted-foreground text-xs"
                style={{ width: 64, minWidth: 64, maxWidth: 64 }}
              >
                {" "}
              </th>

              {columns.map((column, columnIndex) => (
                <RedisColumnHeader
                  column={column}
                  columnIndex={columnIndex}
                  key={column}
                  onClearSort={onClearSort}
                  onSort={onSort}
                  resize={resize}
                  sort={sort}
                />
              ))}

              <th className="sticky top-0 z-40 w-full border-border/50 border-b bg-background" />
            </tr>
          </thead>
          <tbody className="bg-background">
            {rows.map((row, rowIndex) => (
              <tr
                className="group transition-colors hover:bg-input/30"
                data-qa-module="redis"
                data-qa-object="key-row"
                data-qa-resource-id={`${keyName}:${rowIndex}`}
                data-qa-resource-type="redis_key_row"
                data-qa-state="ready"
                data-testid="redis.key.row"
                key={`${currentPage}:${rowIndex}`}
              >
                <td
                  className="sticky left-0 z-30 border-border/50 border-r border-b bg-background px-2 py-2 text-center font-medium text-xs"
                  data-qa-disabled-reason="read_only"
                  data-qa-module="redis"
                  data-qa-object="key-row"
                  data-qa-resource-id={`${keyName}:${rowIndex}`}
                  data-qa-resource-type="redis_key_row"
                  data-qa-state="ready"
                  data-testid="redis.key.row-selector"
                  style={{ width: 64, minWidth: 64, maxWidth: 64 }}
                >
                  {(currentPage - 1) * pageSize + rowIndex + 1}
                </td>

                {columns.map((column, columnIndex) => (
                  <RedisDataCell
                    column={column}
                    columnIndex={columnIndex}
                    highlight={findCellHighlight(
                      find.state.highlightIndex,
                      find.state.currentMatch,
                      rowIndex,
                      column
                    )}
                    key={column}
                    keyName={keyName}
                    resize={resize}
                    rowIndex={rowIndex}
                    targetId={find.meta.getTargetId(rowIndex, column)}
                    value={row[column] ?? null}
                  />
                ))}

                <td className="w-full border-border/50 border-b bg-background" />
              </tr>
            ))}
          </tbody>
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
    </>
  );
}

/** Displays a single Redis key's contents in the read-only DB Access surface. */
export function RedisKeyDetailView({
  active,
  databaseName,
  dbServiceKey,
  keyName,
  objectRef,
  viewKey,
}: RedisKeyDetailViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewState = useDbAccessViewState(viewKey);
  const pagination = useAtomValue(viewState.paginationAtom);
  const sort = useAtomValue(viewState.sortAtom);
  const setCurrentPage = useSetAtom(viewState.setCurrentPageAtom);
  const setPageSize = useSetAtom(viewState.setPageSizeAtom);
  const setSort = useSetAtom(viewState.setSortAtom);
  const clearSortState = useSetAtom(viewState.clearSortAtom);
  const resize = useColumnResize({ rootRef, viewKey });
  const query = useRedisKeyQuery({
    currentPage: pagination.currentPage,
    objectRef,
    pageSize: pagination.pageSize,
    sort,
    viewKey,
  });
  const columns = useMemo(() => query.data?.columns ?? [], [query.data]);
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const total = query.data?.total ?? 0;
  const totalPages = Math.ceil(total / pagination.pageSize);
  const keyType =
    columns.length > 0
      ? detectRedisKeyType(columns, query.data?.disableUpdate ?? false)
      : "string";
  const handleSort = useCallback(
    (column: string, direction: "asc" | "desc") => {
      setSort({ column, direction });
      setCurrentPage(1);
    },
    [setCurrentPage, setSort]
  );
  const clearSort = useCallback(() => {
    clearSortState();
    setCurrentPage(1);
  }, [clearSortState, setCurrentPage]);

  if (query.loading && !query.data) {
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
    <div
      className="relative flex h-full flex-col bg-background"
      data-qa-database={databaseName}
      data-qa-db-service-key={dbServiceKey}
      data-qa-key-type={keyType}
      data-qa-loading={query.loading ? "true" : "false"}
      data-qa-module="redis"
      data-qa-object="key-detail"
      data-qa-resource-id={keyName}
      data-qa-resource-type="redis_key"
      data-qa-state={
        query.error ? "error" : query.loading ? "loading" : "ready"
      }
      data-testid="redis.key.detail"
      ref={rootRef}
      style={resize.getRootStyle(columns)}
    >
      <ColumnResizeGuide />
      <RedisKeyToolbar
        keyName={keyName}
        loading={query.loading}
        objectRef={objectRef}
        onRefresh={query.refresh}
      />

      <RedisFindRegion
        active={active}
        columns={columns}
        currentPage={pagination.currentPage}
        error={query.error}
        keyName={keyName}
        onClearSort={clearSort}
        onDismissError={query.dismissError}
        onSort={handleSort}
        pageSize={pagination.pageSize}
        resize={resize}
        rootRef={rootRef}
        rows={rows}
        sort={sort}
        viewKey={viewKey}
      />

      {total > 0 && (
        <DataView.Pagination
          currentPage={pagination.currentPage}
          itemLabel="entries"
          loading={query.loading}
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
