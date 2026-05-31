import { Button } from "@data-browser/components/ui/Button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@data-browser/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@data-browser/components/ui/tooltip";
import {
  useGetColumnsBatchLazyQuery,
  useGetStorageUnitsLazyQuery,
  useRawExecuteLazyQuery,
} from "@data-browser/generated/graphql";
import { cn } from "@data-browser/lib/utils";
import {
  useDbAccessReadOnlyActions,
  useDbAccessRefresh,
  useDbAccessService,
  useDbAccessTabs,
} from "@data-browser/state/db-access-session";
import {
  getEditorLanguage,
  getUnsupportedRedisCommand,
  isReadOperation,
  resolveSchemaParam,
  supportsSchema,
} from "@data-browser/utils/database-features";
import {
  isLikelyMongoCommand,
  isStandaloneTransactionStatement,
  splitMongoStatements,
  splitRedisCommands,
  splitSQLStatements,
} from "@data-browser/utils/sql-split";
import {
  AlertCircle,
  AlignLeft,
  CheckCircle,
  CheckCircle2,
  Database,
  FileText,
  GalleryVerticalEnd,
  Loader2,
  Network,
  Play,
  XCircle,
} from "lucide-react";
import type * as Monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "sql-formatter";
import MonacoEditor from "./MonacoEditorWrapper";
import type { ColumnInfo, SQLCompletionData } from "./sql-completion";
import { registerSQLCompletionProvider } from "./sql-completion";

const IS_MAC =
  typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

interface SQLEditorViewProps {
  context?: {
    dbServiceKey: string;
    databaseName?: string;
    schemaName?: string;
  } | null;
  initialSql?: string;
  /** Called after a successful read query with the result columns, rows, and execution context. */
  onQueryResults?: (
    columns: string[],
    rows: Record<string, any>[],
    context: { database?: string; schema?: string }
  ) => void;
  onSqlChange?: (sql: string) => void;
  tabId: string;
}

interface StatementResult {
  columns: string[];
  database?: string;
  info: string;
  isError?: boolean;
  rows: Record<string, string>[];
  schema?: string;
  sql: string;
}

/** SQL editor with integrated database/schema selectors and query execution. */
export function SQLEditorView({
  tabId,
  context,
  initialSql,
  onSqlChange,
  onQueryResults,
}: SQLEditorViewProps) {
  const dbService = useDbAccessService();
  const dbServiceEngineType = dbService.engineType;
  const [rawExecute] = useRawExecuteLazyQuery({ fetchPolicy: "no-cache" });
  const [fetchStorageUnits] = useGetStorageUnitsLazyQuery({
    fetchPolicy: "no-cache",
  });
  const [fetchColumnsBatch] = useGetColumnsBatchLazyQuery({
    fetchPolicy: "no-cache",
  });
  const [activeResultTab, setActiveResultTab] = useState<"result" | "message">(
    "result"
  );
  const [query, setQuery] = useState(initialSql || "");
  const [isExecuting, setIsExecuting] = useState(false);
  const [queryResults, setQueryResults] = useState<StatementResult[] | null>(
    null
  );
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [monacoInstance, setMonacoInstance] = useState<typeof Monaco | null>(
    null
  );
  const { updateTab } = useDbAccessTabs();
  const { triggerSidebarRefresh } = useDbAccessRefresh();
  const { fetchDatabases, fetchSchemas } = useDbAccessReadOnlyActions();
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState(
    context?.databaseName ?? ""
  );
  const [selectedSchema, setSelectedSchema] = useState(
    context?.schemaName ?? ""
  );

  // Fetch databases on mount
  useEffect(() => {
    if (!context?.dbServiceKey) {
      return;
    }
    fetchDatabases().then(setDatabases).catch(console.error);
  }, [context?.dbServiceKey, fetchDatabases]);

  // Fetch schemas when database changes (Postgres only), default to "public" or first available
  useEffect(() => {
    if (
      !(
        context?.dbServiceKey &&
        selectedDatabase &&
        supportsSchema(dbServiceEngineType)
      )
    ) {
      return;
    }
    fetchSchemas()
      .then((result) => {
        setSchemas(result);
        if (!selectedSchema && result.length > 0) {
          const defaultSchema = result.includes("public")
            ? "public"
            : result[0];
          if (defaultSchema) {
            setSelectedSchema(defaultSchema);
          }
        }
      })
      .catch(console.error);
  }, [
    context?.dbServiceKey,
    selectedDatabase,
    dbServiceEngineType,
    fetchSchemas,
  ]);

  // Register SQL completion provider when schema metadata is available
  useEffect(() => {
    if (getEditorLanguage(dbServiceEngineType) !== "sql") {
      return;
    }
    if (!monacoInstance) {
      return;
    }

    const schemaParam = resolveSchemaParam(
      dbServiceEngineType,
      selectedDatabase,
      selectedSchema
    );
    if (!schemaParam) {
      return;
    }

    let disposed = false;
    let disposable: Monaco.IDisposable | null = null;

    (async () => {
      const database = selectedDatabase || context?.databaseName;
      const { data: storageData } = await fetchStorageUnits({
        variables: { schema: schemaParam },
        context: { database },
      });
      if (disposed || !storageData?.StorageUnit) {
        return;
      }

      const tableNames = storageData.StorageUnit.map((u) => u.Name);
      if (tableNames.length === 0) {
        return;
      }

      const { data: columnsData } = await fetchColumnsBatch({
        variables: { schema: schemaParam, storageUnits: tableNames },
        context: { database },
      });
      if (disposed) {
        return;
      }

      const columns = new Map<string, ColumnInfo[]>();
      if (columnsData?.ColumnsBatch) {
        for (const batch of columnsData.ColumnsBatch) {
          columns.set(
            batch.StorageUnit,
            batch.Columns.map((c) => ({
              name: c.Name,
              type: c.Type,
              isPrimary: c.IsPrimary,
              isForeignKey: c.IsForeignKey,
            }))
          );
        }
      }

      const completionData: SQLCompletionData = { tables: tableNames, columns };
      disposable = registerSQLCompletionProvider(
        monacoInstance,
        completionData
      );
    })();

    return () => {
      disposed = true;
      disposable?.dispose();
    };
  }, [
    dbServiceEngineType,
    selectedDatabase,
    selectedSchema,
    monacoInstance,
    fetchStorageUnits,
    fetchColumnsBatch,
  ]);

  const handleDatabaseChange = (db: string) => {
    setSelectedDatabase(db);
    if (supportsSchema(dbServiceEngineType)) {
      setSelectedSchema("");
      updateTab(tabId, { databaseName: db, schemaName: undefined });
    } else {
      updateTab(tabId, { databaseName: db });
    }
  };

  const handleSchemaChange = (schema: string) => {
    setSelectedSchema(schema);
    updateTab(tabId, { schemaName: schema });
  };

  const handleRun = async () => {
    const upperType = dbServiceEngineType.toUpperCase();
    const statements =
      upperType === "REDIS"
        ? splitRedisCommands(query)
        : upperType === "MONGODB"
          ? splitMongoStatements(query)
          : splitSQLStatements(query);
    if (statements.length === 0) {
      return;
    }

    setIsExecuting(true);
    setQueryResults(null);
    const executionDatabase = selectedDatabase || context?.databaseName;
    const executionSchema = selectedSchema || context?.schemaName;
    const startTime = Date.now();
    const results: StatementResult[] = [];

    for (let idx = 0; idx < statements.length; idx++) {
      const sql = statements[idx];
      if (!sql) {
        continue;
      }

      // Block unsupported Redis commands with a clear message
      if (upperType === "REDIS") {
        const unsupportedMessage = getUnsupportedRedisCommand(sql);
        if (unsupportedMessage) {
          results.push({
            columns: [],
            rows: [],
            info: unsupportedMessage,
            isError: true,
            sql,
            database: executionDatabase,
            schema: executionSchema,
          });
          break;
        }
      }

      // Reject non-command MongoDB statements early with a localized, targeted error
      if (upperType === "MONGODB" && !isLikelyMongoCommand(sql)) {
        results.push({
          columns: [],
          rows: [],
          info: `Unsupported MongoDB statement: ${sql}`,
          isError: true,
          sql,
          database: executionDatabase,
          schema: executionSchema,
        });
        continue;
      }

      // Block standalone transaction statements with a warning
      if (
        upperType !== "REDIS" &&
        upperType !== "MONGODB" &&
        isStandaloneTransactionStatement(sql)
      ) {
        results.push({
          columns: [],
          rows: [],
          info: "Transaction statements are not supported in this editor.",
          isError: true,
          sql,
          database: executionDatabase,
          schema: executionSchema,
        });
        continue;
      }

      try {
        const { data, error } = await rawExecute({
          variables: { query: sql },
          context: { database: selectedDatabase || context?.databaseName },
        });

        if (error) {
          results.push({
            columns: [],
            rows: [],
            info: error.message,
            isError: true,
            sql,
            database: executionDatabase,
            schema: executionSchema,
          });
          break;
        }

        if (data?.RawExecute) {
          const raw = data.RawExecute;
          const columns = raw.Columns.map((c) => c.Name);

          if (
            isReadOperation(dbServiceEngineType, sql) ||
            raw.Rows.length > 0
          ) {
            const rows = raw.Rows.map((row) =>
              Object.fromEntries(columns.map((col, i) => [col, row[i] ?? ""]))
            );
            results.push({
              columns,
              rows,
              info: `${raw.TotalCount} row(s)`,
              sql,
              database: executionDatabase,
              schema: executionSchema,
            });
          } else {
            results.push({
              columns: [],
              rows: [],
              info: "Statement executed.",
              sql,
              database: executionDatabase,
              schema: executionSchema,
            });
          }
        }
      } catch (err: any) {
        results.push({
          columns: [],
          rows: [],
          info: err.message,
          isError: true,
          sql,
          database: executionDatabase,
          schema: executionSchema,
        });
      }
    }

    const endTime = Date.now();
    setExecutionTime((endTime - startTime) / 1000);

    setQueryResults(results);
    setActiveResultTab(results.some((r) => r.isError) ? "message" : "result");

    // Notify parent of the last successful read result
    const lastRead = [...results]
      .reverse()
      .find((r) => !r.isError && r.rows.length > 0);
    if (lastRead) {
      onQueryResults?.(lastRead.columns, lastRead.rows, {
        database: lastRead.database ?? executionDatabase,
        schema: lastRead.schema ?? executionSchema,
      });
    }

    // Refresh sidebar tree when a write operation succeeded (DDL/DML may change schema objects)
    const hasSuccessfulWrite = results.some(
      (r) => !(r.isError || isReadOperation(dbServiceEngineType, r.sql))
    );
    if (hasSuccessfulWrite) {
      triggerSidebarRefresh();
    }

    setIsExecuting(false);
  };

  const handleFormat = () => {
    if (!query.trim()) {
      return;
    }
    try {
      const formatted = format(query);
      setQuery(formatted);
      onSqlChange?.(formatted);
      if (editorRef.current) {
        editorRef.current.setValue(formatted);
      }
    } catch {
      // sql-formatter can't parse the query — leave it as-is
    }
  };

  // Keep refs in sync so Monaco keybindings always call the latest handlers
  const handleRunRef = useRef(handleRun);
  handleRunRef.current = handleRun;
  const handleFormatRef = useRef(handleFormat);
  handleFormatRef.current = handleFormat;
  const isExecutingRef = useRef(isExecuting);
  isExecutingRef.current = isExecuting;

  const [resultsHeight, setResultsHeight] = useState(400);
  const isResizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!(isResizing.current && containerRef.current)) {
        return;
      }
      const containerRect = containerRef.current.getBoundingClientRect();
      const newHeight = containerRect.bottom - e.clientY;
      const minHeight = 40;
      const maxHeight = containerRect.height - 100;
      setResultsHeight(Math.min(maxHeight, Math.max(minHeight, newHeight)));
    };

    const handleMouseUp = () => {
      if (!isResizing.current) {
        return;
      }
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background"
      data-qa-database={selectedDatabase || context?.databaseName}
      data-qa-db-service-key={context?.dbServiceKey}
      data-qa-loading={isExecuting ? "true" : "false"}
      data-qa-module="sql"
      data-qa-object="editor"
      data-qa-schema={selectedSchema || context?.schemaName}
      data-qa-state={
        isExecuting
          ? "executing"
          : queryResults?.some((r) => r.isError)
            ? "error"
            : queryResults
              ? "completed"
              : "ready"
      }
      data-testid="sql.editor.view"
      ref={containerRef}
    >
      {/* Toolbar */}
      <div
        className="flex h-12 shrink-0 items-center justify-between border-b px-2"
        data-qa-module="sql"
        data-qa-object="editor-toolbar"
        data-qa-state={isExecuting ? "executing" : "ready"}
        data-testid="sql.editor.toolbar"
      >
        {/* Left: Action Buttons */}
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                data-qa-action="execute"
                data-qa-disabled-reason={isExecuting ? "executing" : undefined}
                data-qa-module="sql"
                data-qa-object="query"
                data-qa-risk="query_execution"
                data-qa-state={isExecuting ? "executing" : "ready"}
                data-testid="sql.editor.run-button"
                disabled={isExecuting}
                onClick={handleRun}
                size="icon"
                variant="ghost"
              >
                {isExecuting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {"Run"} ({IS_MAC ? "⌘↩" : "Ctrl+Enter"})
            </TooltipContent>
          </Tooltip>
          {getEditorLanguage(dbServiceEngineType) === "sql" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  data-qa-action="format"
                  data-qa-disabled-reason={
                    query.trim() ? undefined : "empty_query"
                  }
                  data-qa-module="sql"
                  data-qa-object="query"
                  data-testid="sql.editor.format-button"
                  disabled={!query.trim()}
                  onClick={handleFormat}
                  size="icon"
                  variant="ghost"
                >
                  <AlignLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {"Format"} ({IS_MAC ? "⇧⌥F" : "Shift+Alt+F"})
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Right: Database/Schema Selectors */}
        <div className="flex items-center gap-2">
          {/* Database Selector */}
          <Select
            disabled={databases.length === 0}
            onValueChange={handleDatabaseChange}
            value={selectedDatabase || undefined}
          >
            <SelectTrigger
              className="gap-1.5 border-0 bg-transparent shadow-none"
              data-qa-disabled-reason={
                databases.length === 0 ? "no_databases" : undefined
              }
              data-qa-field="database"
              data-qa-module="sql"
              data-qa-object="execution-context"
              data-qa-state={databases.length === 0 ? "empty" : "ready"}
              data-testid="sql.editor.database-select"
            >
              <Database className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder={"Select database"} />
            </SelectTrigger>
            <SelectContent
              align="end"
              data-qa-field="database"
              data-qa-module="sql"
              data-qa-object="execution-context-options"
              data-testid="sql.editor.database-select-content"
            >
              {databases.map((db) => (
                <SelectItem
                  data-qa-action="select"
                  data-qa-module="sql"
                  data-qa-object="database"
                  data-qa-resource-id={db}
                  data-qa-resource-type="database"
                  data-testid="sql.editor.database-option"
                  key={db}
                  value={db}
                >
                  {db}
                </SelectItem>
              ))}
              {databases.length === 0 && (
                <div className="px-3 py-2 text-muted-foreground text-sm">
                  {"No databases available"}
                </div>
              )}
            </SelectContent>
          </Select>

          {/* Schema Selector (Postgres only) */}
          {supportsSchema(dbServiceEngineType) && (
            <Select
              disabled={!selectedDatabase || schemas.length === 0}
              onValueChange={handleSchemaChange}
              value={selectedSchema || undefined}
            >
              <SelectTrigger
                className="gap-1.5 border-0 bg-transparent shadow-none"
                data-qa-disabled-reason={
                  selectedDatabase
                    ? schemas.length === 0
                      ? "no_schemas"
                      : undefined
                    : "database_required"
                }
                data-qa-field="schema"
                data-qa-module="sql"
                data-qa-object="execution-context"
                data-qa-state={schemas.length === 0 ? "empty" : "ready"}
                data-testid="sql.editor.schema-select"
              >
                <Network className="h-4 w-4 text-muted-foreground" />
                <SelectValue placeholder={"Select schema"} />
              </SelectTrigger>
              <SelectContent
                align="end"
                data-qa-field="schema"
                data-qa-module="sql"
                data-qa-object="execution-context-options"
                data-testid="sql.editor.schema-select-content"
              >
                {schemas.map((schema) => (
                  <SelectItem
                    data-qa-action="select"
                    data-qa-module="sql"
                    data-qa-object="schema"
                    data-qa-resource-id={schema}
                    data-qa-resource-type="schema"
                    data-testid="sql.editor.schema-option"
                    key={schema}
                    value={schema}
                  >
                    {schema}
                  </SelectItem>
                ))}
                {schemas.length === 0 && (
                  <div className="px-3 py-2 text-muted-foreground text-sm">
                    {"No schemas available"}
                  </div>
                )}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* Main Content Area (Split View) */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {/* Editor Area */}
        <div
          className="flex-1 overflow-hidden"
          data-qa-field="query"
          data-qa-module="sql"
          data-qa-object="query-input"
          data-testid="sql.editor.input-region"
          style={{ marginBottom: isResizing ? 0 : 0 }}
        >
          <MonacoEditor
            height="100%"
            language={getEditorLanguage(dbServiceEngineType)}
            onChange={(value: string | undefined) => {
              const v = value || "";
              setQuery(v);
              onSqlChange?.(v);
            }}
            onMount={(
              editorInstance: editor.IStandaloneCodeEditor,
              monacoInstance: typeof Monaco
            ) => {
              editorRef.current = editorInstance;
              setMonacoInstance(monacoInstance);

              editorInstance.addAction({
                id: "run-query",
                label: "Run Query",
                keybindings: [
                  monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Enter,
                ],
                run: () => {
                  if (!isExecutingRef.current) {
                    handleRunRef.current();
                  }
                },
              });

              editorInstance.addAction({
                id: "format-sql",
                label: "Format SQL",
                keybindings: [
                  monacoInstance.KeyMod.Shift |
                    monacoInstance.KeyMod.Alt |
                    monacoInstance.KeyCode.KeyF,
                ],
                run: () => {
                  handleFormatRef.current();
                },
              });
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              roundedSelection: false,
              scrollBeyondLastLine: false,
              readOnly: false,
              automaticLayout: true,
              suggestOnTriggerCharacters: true,
              quickSuggestions: true,
              wordBasedSuggestions: "off",
            }}
            theme="vs-light"
            value={query}
          />
        </div>

        {/* Resize Handle */}
        <div
          className="z-10 h-1 w-full cursor-row-resize hover:bg-primary/30 active:bg-primary/50"
          data-qa-action="resize"
          data-qa-module="sql"
          data-qa-object="result-pane"
          data-testid="sql.editor.result-resize-handle"
          onMouseDown={handleResizeMouseDown}
        />

        {/* Results Pane */}
        <div
          className="flex flex-col border-t bg-background transition-[height] duration-75 ease-out"
          data-qa-loading={isExecuting ? "true" : "false"}
          data-qa-module="sql"
          data-qa-object="query-result"
          data-qa-state={
            isExecuting
              ? "loading"
              : queryResults?.some((r) => r.isError)
                ? "error"
                : queryResults
                  ? "success"
                  : "empty"
          }
          data-testid="sql.editor.result-pane"
          style={{ height: resultsHeight, maxHeight: "80%" }}
        >
          {/* Result Tabs */}
          <div className="flex h-10 items-center border-b bg-muted/10">
            <Button
              className={cn(
                "h-full w-25 rounded-none border-b-2 px-4 py-2 font-normal text-sm",
                activeResultTab === "result"
                  ? "border-primary bg-background text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-qa-action="show-result"
              data-qa-module="sql"
              data-qa-object="result-pane-tab"
              data-qa-state={
                activeResultTab === "result" ? "active" : "inactive"
              }
              data-testid="sql.editor.result-tab"
              onClick={() => setActiveResultTab("result")}
              size="sm"
              variant="ghost"
            >
              <FileText className="h-4 w-4" />
              {"Results"}
            </Button>
            <Button
              className={cn(
                "h-full w-25 rounded-none border-b-2 px-4 py-2 font-normal text-sm",
                activeResultTab === "message"
                  ? "border-primary bg-background text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
              data-qa-action="show-message"
              data-qa-module="sql"
              data-qa-object="result-pane-tab"
              data-qa-state={
                activeResultTab === "message" ? "active" : "inactive"
              }
              data-testid="sql.editor.message-tab"
              onClick={() => setActiveResultTab("message")}
              size="sm"
              variant="ghost"
            >
              {queryResults?.some((r) => r.isError) ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              {"Message"}
            </Button>
          </div>

          {/* Result Content */}
          <div className="flex-1 overflow-auto bg-background/50 p-0">
            {activeResultTab === "result" && (
              <div className="w-full text-sm">
                {queryResults && queryResults.length > 0 ? (
                  <div className="divide-y divide-border">
                    {queryResults.map((result, resultIndex) => (
                      <div
                        className="flex flex-col"
                        data-qa-error-code={
                          result.isError ? "query_execution_failed" : undefined
                        }
                        data-qa-module="sql"
                        data-qa-object="statement-result"
                        data-qa-result-index={resultIndex}
                        data-qa-row-count={result.rows.length}
                        data-qa-state={result.isError ? "error" : "success"}
                        data-testid="sql.editor.result-set"
                        key={resultIndex}
                      >
                        {/* Result Header */}
                        <div className="flex flex-col border-border/50 border-b">
                          <div
                            className={cn(
                              "flex items-center justify-between px-4 py-2.5",
                              result.isError
                                ? "bg-destructive/5"
                                : "bg-muted/30"
                            )}
                            data-qa-module="sql"
                            data-qa-object="statement-result"
                            data-qa-state={result.isError ? "error" : "success"}
                            data-testid="sql.editor.result-set-header"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={cn(
                                  "flex h-5 w-5 items-center justify-center rounded-full",
                                  result.isError
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-green-500/10 text-green-500"
                                )}
                              >
                                {result.isError ? (
                                  <XCircle className="h-3.5 w-3.5" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                )}
                              </div>
                              <span className="font-medium text-foreground text-sm">
                                {`Result ${resultIndex + 1}`}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 font-medium text-xs",
                                  result.isError
                                    ? "bg-destructive/10 text-destructive"
                                    : "border border-green-500/20 bg-green-500/10 text-green-500"
                                )}
                              >
                                {result.isError
                                  ? "Error"
                                  : result.info || "Success"}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-muted-foreground text-xs">
                              {!result.isError && (
                                <span className="flex items-center gap-1.5">
                                  <GalleryVerticalEnd className="h-3.5 w-3.5" />
                                  {`${result.rows.length} row(s)`}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* SQL Statement Display */}
                          {result.sql && queryResults.length > 1 && (
                            <div className="border-border/50 border-t border-b bg-muted/30 px-4 py-2">
                              <code
                                className={cn(
                                  "block whitespace-pre-wrap break-all border-l-2 pl-2 font-mono text-sm",
                                  result.isError
                                    ? "border-destructive bg-destructive/5 text-destructive"
                                    : "border-primary/30 text-muted-foreground"
                                )}
                              >
                                {result.sql}
                              </code>
                            </div>
                          )}
                        </div>

                        {/* Result Body */}
                        {result.isError ? (
                          <div className="px-4 py-3">
                            <div className="flex items-start gap-2 text-destructive text-sm">
                              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                              <pre className="whitespace-pre-wrap break-all font-mono text-xs">
                                {result.info}
                              </pre>
                            </div>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table
                              className="w-full border-collapse text-left"
                              data-qa-module="sql"
                              data-qa-object="result-table"
                              data-qa-row-count={result.rows.length}
                              data-qa-state={
                                result.rows.length > 0 ? "ready" : "empty"
                              }
                              data-testid="sql.editor.result-table"
                            >
                              <thead className="sticky top-0 z-10 bg-muted">
                                <tr>
                                  <th className="w-16 border-r border-b bg-muted px-4 py-2 text-center font-medium text-muted-foreground">
                                    #
                                  </th>
                                  {result.columns.map((col, i) => (
                                    <th
                                      className="whitespace-nowrap border-r border-b bg-muted px-4 py-2 font-medium text-muted-foreground"
                                      key={i}
                                    >
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {result.rows.length > 0 ? (
                                  result.rows.map((row, i) => (
                                    <tr
                                      className="hover:bg-input/30"
                                      data-qa-module="sql"
                                      data-qa-object="result-row"
                                      data-qa-row-index={i}
                                      data-qa-state="ready"
                                      data-testid="sql.editor.result-row"
                                      key={i}
                                    >
                                      <td className="border-r border-b bg-muted/5 px-4 py-1.5 text-center font-mono text-muted-foreground text-xs">
                                        {i + 1}
                                      </td>
                                      {result.columns.map((col, j) => (
                                        <td
                                          className="max-w-[300px] truncate whitespace-nowrap border-r border-b px-4 py-1.5"
                                          data-qa-field={col}
                                          data-qa-module="sql"
                                          data-qa-object="result-cell"
                                          data-qa-row-index={i}
                                          data-testid="sql.editor.result-cell"
                                          key={j}
                                        >
                                          {typeof row[col] === "object"
                                            ? JSON.stringify(row[col])
                                            : String(row[col] ?? "")}
                                        </td>
                                      ))}
                                    </tr>
                                  ))
                                ) : (
                                  <tr>
                                    <td
                                      className="px-4 py-8 text-center text-muted-foreground"
                                      colSpan={result.columns.length + 1}
                                      data-qa-module="sql"
                                      data-qa-object="result-table"
                                      data-qa-state="empty"
                                      data-testid="sql.editor.result-empty"
                                    >
                                      {"No rows returned"}
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : isExecuting ? (
                  <div className="flex h-full min-h-[200px] items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Play className="h-8 w-8 opacity-20" />
                    <span>{"Run a query to see results"}</span>
                  </div>
                )}
              </div>
            )}
            {activeResultTab === "message" && (
              <div className="space-y-2 p-4 font-mono text-sm">
                {queryResults && queryResults.length > 0 ? (
                  <>
                    {queryResults.map((result, idx) => (
                      <div
                        className={cn(
                          "flex flex-col gap-1 rounded px-3 py-2",
                          result.isError ? "bg-destructive/5" : "bg-muted/30"
                        )}
                        data-qa-error-code={
                          result.isError ? "query_execution_failed" : undefined
                        }
                        data-qa-module="sql"
                        data-qa-object="statement-message"
                        data-qa-result-index={idx}
                        data-qa-state={result.isError ? "error" : "success"}
                        data-testid="sql.editor.message-item"
                        key={idx}
                      >
                        <div className="flex items-center gap-2">
                          {result.isError ? (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                          )}
                          <span className="font-medium text-xs">
                            {`Result ${idx + 1}`}
                          </span>
                          {queryResults.length > 1 && (
                            <code className="max-w-[400px] truncate text-muted-foreground text-xs">
                              {result.sql}
                            </code>
                          )}
                        </div>
                        <div
                          className={cn(
                            "pl-6 text-xs",
                            result.isError
                              ? "text-destructive"
                              : "text-muted-foreground"
                          )}
                        >
                          {result.info}
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 border-t pt-2 text-muted-foreground text-xs">
                      <span>
                        {`${queryResults.length} statement(s), ${
                          queryResults.filter((r) => !r.isError).length
                        } succeeded, ${queryResults.filter((r) => r.isError).length} failed in ${executionTime?.toFixed(3) ?? "0"}s`}
                      </span>
                    </div>
                  </>
                ) : isExecuting ? (
                  <div className="flex min-h-[160px] items-center justify-center text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    {"No query executed"}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
