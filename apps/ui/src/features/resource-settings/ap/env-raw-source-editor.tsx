"use client";

import type { Monaco, OnMount } from "@monaco-editor/react";
import { Editor } from "@monaco-editor/react";
import { fieldInvalidRingClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import type { editor, IDisposable, languages } from "monaco-editor";
import {
  useCallback,
  useEffect,
  useId,
  useInsertionEffect,
  useMemo,
  useRef,
} from "react";
import {
  type ApEnvRawSourceDiagnostic,
  apEnvRawSourceReferenceSuggestionContext,
} from "./lib/ap-env-raw-source";

const ENV_RAW_SOURCE_MONACO_LANGUAGE = "ap-env-raw-source";
const ENV_RAW_SOURCE_MARKER_OWNER = "ap-env-raw-source";
let envRawSourceMonacoConfigured = false;

/**
 * One `${{ ... }}` completion entry for the raw editor. Hosts that support
 * references (AP Settings) provide these; hosts that do not (deploy forms)
 * omit them and the editor offers no completions.
 */
export interface EnvRawSourceCompletionItem {
  /** Right-aligned detail column (e.g. the DB name). */
  detail: string;
  documentation: string;
  /** The literal `${{db.VAR}}` text inserted on accept. */
  expression: string;
  label: string;
  sortText: string;
}

export interface EnvRawSourceEditorProps {
  completionItems?: readonly EnvRawSourceCompletionItem[];
  diagnostic?: ApEnvRawSourceDiagnostic;
  onChange: (source: string) => void;
  readOnly?: boolean;
  value: string;
}

function configureEnvRawSourceMonaco(monaco: Monaco) {
  if (envRawSourceMonacoConfigured) {
    return;
  }
  if (
    !monaco.languages
      .getLanguages()
      .some(
        (language: { id: string }) =>
          language.id === ENV_RAW_SOURCE_MONACO_LANGUAGE
      )
  ) {
    monaco.languages.register({ id: ENV_RAW_SOURCE_MONACO_LANGUAGE });
  }
  monaco.editor.defineTheme("ap-env-raw-source-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#00000000",
      "editorLineNumber.foreground": "#6b7280",
      "editorLineNumber.activeForeground": "#d1d5db",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": "#e5e7eb",
      "editor.selectionBackground": "#2563eb66",
      "editorSuggestWidget.background": "#00000000",
      "editorSuggestWidget.border": "#00000000",
      "editorSuggestWidget.foreground": "#e5e7eb",
      "editorSuggestWidget.focusHighlightForeground": "#f8fafc",
      "editorSuggestWidget.highlightForeground": "#f8fafc",
      "editorSuggestWidget.selectedBackground": "#ffffff26",
      "editorSuggestWidget.selectedForeground": "#f8fafc",
      "editorSuggestWidget.selectedIconForeground": "#f8fafc",
    },
  });
  envRawSourceMonacoConfigured = true;
}

function syncEnvRawSourceMarkers({
  diagnostics,
  editorInstance,
  monaco,
}: {
  diagnostics: readonly ApEnvRawSourceDiagnostic[];
  editorInstance: editor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
}) {
  const model = editorInstance?.getModel();
  if (model == null || monaco == null) {
    return;
  }
  monaco.editor.setModelMarkers(
    model,
    ENV_RAW_SOURCE_MARKER_OWNER,
    diagnostics.map((diagnostic) => {
      const lineCount = model.getLineCount();
      const line = Math.max(1, Math.min(lineCount, diagnostic.line));
      return {
        endColumn: model.getLineMaxColumn(line),
        endLineNumber: line,
        message: diagnostic.message,
        severity: monaco.MarkerSeverity.Error,
        source: ENV_RAW_SOURCE_MARKER_OWNER,
        startColumn: 1,
        startLineNumber: line,
      };
    })
  );
}

/**
 * Shared `.env` raw source editor (Monaco): syntax-aware line diagnostics and
 * optional reference completion. The AP Settings Environment section and the
 * Docker deploy form both edit the same AP Environment Raw Source model
 * through this editor.
 */
export function EnvRawSourceEditor({
  completionItems,
  diagnostic,
  onChange,
  readOnly = false,
  value,
}: EnvRawSourceEditorProps) {
  const editorId = useId();
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<IDisposable | null>(null);
  const diagnosticsRef = useRef<readonly ApEnvRawSourceDiagnostic[]>([]);
  const completionItemsRef = useRef<readonly EnvRawSourceCompletionItem[]>([]);
  const editorPath = useMemo(
    () => `inmemory://ap-env-raw-source/${encodeURIComponent(editorId)}.env`,
    [editorId]
  );
  const diagnostics = useMemo(
    () => (diagnostic == null ? [] : [diagnostic]),
    [diagnostic]
  );
  useInsertionEffect(() => {
    diagnosticsRef.current = diagnostics;
    completionItemsRef.current = completionItems ?? [];
  });

  const handleMount = useCallback<OnMount>((editorInstance, monaco) => {
    editorInstanceRef.current = editorInstance;
    monacoRef.current = monaco;
    completionProviderRef.current?.dispose();
    const completionProvider: languages.CompletionItemProvider = {
      provideCompletionItems(model, position) {
        if (model !== editorInstance.getModel()) {
          return { suggestions: [] };
        }
        const context = apEnvRawSourceReferenceSuggestionContext(
          model.getLineContent(position.lineNumber),
          position.column
        );
        if (context === undefined) {
          return { suggestions: [] };
        }
        const range = {
          endColumn: context.endColumn,
          endLineNumber: position.lineNumber,
          startColumn: context.startColumn,
          startLineNumber: position.lineNumber,
        };
        return {
          suggestions: completionItemsRef.current.map((item) => ({
            detail: item.detail,
            documentation: item.documentation,
            filterText: item.expression,
            insertText: item.expression,
            kind: monaco.languages.CompletionItemKind.Reference,
            label: {
              description: item.detail,
              label: item.label,
            },
            range,
            sortText: item.sortText,
          })),
        };
      },
      triggerCharacters: ["{"],
    };
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider(
        ENV_RAW_SOURCE_MONACO_LANGUAGE,
        completionProvider
      );
    syncEnvRawSourceMarkers({
      diagnostics: diagnosticsRef.current,
      editorInstance,
      monaco,
    });
  }, []);

  useEffect(
    () => () => {
      completionProviderRef.current?.dispose();
      completionProviderRef.current = null;
    },
    []
  );

  useEffect(() => {
    syncEnvRawSourceMarkers({
      diagnostics,
      editorInstance: editorInstanceRef.current,
      monaco: monacoRef.current,
    });
  }, [diagnostics]);

  return (
    <>
      <div className="grid min-w-0 gap-2">
        <div
          className={cn(
            "min-h-48 overflow-visible rounded-md border border-input bg-transparent shadow-xs dark:bg-input/30",
            diagnostic == null ? null : fieldInvalidRingClass
          )}
          data-slot="ap-env-raw-source-frame"
        >
          <Editor
            beforeMount={configureEnvRawSourceMonaco}
            defaultLanguage={ENV_RAW_SOURCE_MONACO_LANGUAGE}
            height="12rem"
            keepCurrentModel={false}
            language={ENV_RAW_SOURCE_MONACO_LANGUAGE}
            loading={
              <span className="text-muted-foreground text-sm">
                Loading editor…
              </span>
            }
            onChange={(nextValue) => onChange(nextValue ?? "")}
            onMount={handleMount}
            options={{
              allowOverflow: true,
              automaticLayout: true,
              domReadOnly: readOnly,
              extraEditorClassName: "ap-env-raw-source-monaco",
              folding: false,
              fontFamily:
                "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)",
              fontSize: 13,
              glyphMargin: false,
              hideCursorInOverviewRuler: true,
              lineDecorationsWidth: 8,
              lineNumbers: "on",
              lineNumbersMinChars: 3,
              minimap: { enabled: false },
              overviewRulerLanes: 0,
              padding: { bottom: 8, top: 8 },
              quickSuggestions: false,
              readOnly,
              renderLineHighlight: "line",
              scrollBeyondLastLine: false,
              scrollbar: {
                horizontalScrollbarSize: 8,
                verticalScrollbarSize: 8,
              },
              suggestFontSize: 12,
              suggestLineHeight: 28,
              suggest: {
                preview: false,
                selectionMode: "always",
                showIcons: false,
                showInlineDetails: true,
                showStatusBar: false,
                showWords: false,
                snippetsPreventQuickSuggestions: true,
              },
              suggestOnTriggerCharacters: true,
              tabSize: 2,
              wordBasedSuggestions: "off",
              wordWrap: "on",
            }}
            path={editorPath}
            saveViewState={false}
            theme="ap-env-raw-source-dark"
            value={value}
            wrapperProps={{
              "aria-invalid": diagnostic != null,
              "aria-label": "Environment raw source",
              "data-slot": "ap-env-raw-source-editor",
            }}
          />
        </div>
      </div>
      {diagnostic == null ? null : (
        <p className="text-destructive text-xs" role="status">
          Line {diagnostic.line}: {diagnostic.message}
        </p>
      )}
    </>
  );
}
