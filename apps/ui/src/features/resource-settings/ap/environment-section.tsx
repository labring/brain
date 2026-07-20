"use client";

import type { Monaco, OnMount } from "@monaco-editor/react";
import { Editor } from "@monaco-editor/react";
import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Badge } from "@workspace/ui/components/badge";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import type { SlidingToggleOption } from "@workspace/ui/components/sliding-toggle";
import { fieldInvalidRingClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import {
  Braces,
  Check,
  Copy,
  Eye,
  EyeClosed,
  Save,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { editor, IDisposable, languages } from "monaco-editor";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ApEnvRawSourceDiagnostic,
  apEnvRawAssignmentsToRows,
  apEnvRawSourceReferenceSuggestionContext,
  apEnvRawSourceRows,
  appendApEnvRawSourceRow,
  buildApEnvReferenceMenuItems,
  insertApEnvReferenceText,
  type parseApEnvRawSource,
  resolveApEnvRawSourceReferences,
} from "./lib/ap-env-raw-source";
import {
  type ApEnvDbDsnReferenceTarget,
  type ApEnvDbDsnSource,
  type ApEnvDbReferenceField,
  type ApEnvRow,
  apEnvRowsModelEqual,
  type validateApEnvRows,
} from "./lib/ap-env-rows";
import { apEnvDbSourceKey, type EnvTokenDiagnostic } from "./lib/ap-env-tokens";

export interface ApEnvVar extends ApEnvRow {}

const AP_ENV_RAW_SOURCE_MONACO_LANGUAGE = "ap-env-raw-source";
const AP_ENV_RAW_SOURCE_MARKER_OWNER = "ap-env-raw-source";
const REFERENCE_PICKER_QUERY_SPLIT_RE = /\s+/;
const AP_ENV_REFERENCE_VARIABLE_SORT_ORDER: Record<string, number> = {
  DATABASE_URL: 0,
  PG_USER: 1,
  PG_PASSWORD: 2,
  PG_HOST: 3,
  PG_PORT: 4,
};
const AP_ENV_REFERENCE_VARIABLE_DESCRIPTIONS: Record<string, string> = {
  DATABASE_URL: "Connection string",
  PG_HOST: "Host",
  PG_PASSWORD: "Password secret",
  PG_PORT: "Port",
  PG_USER: "Username secret",
};
let apEnvRawSourceMonacoConfigured = false;

type ApEnvReferenceMenuItem = ReturnType<
  typeof buildApEnvReferenceMenuItems
>[number];

export interface ApSettingsAddDbDsnReferenceIntent {
  dbName: string;
  dbNamespace: string;
  id: string;
}

export interface ApSettingsConfirmedAddDbDsnReference {
  dbName: string;
  dbNamespace: string;
  id: string;
}

export interface ApSettingsPendingDbReference {
  dbName: string;
  dbNamespace: string;
}

export interface ApSettingsEnvChangeMeta {
  confirmedAddDbDsnReferences?: ApSettingsConfirmedAddDbDsnReference[];
  envRawSource?: string;
}

interface AddDbDsnReferenceIntentDraftMetadata {
  canvasAddDbDsnReferenceIntentId?: string;
}

export type EnvEditorMode = "raw" | "structured";
export type EnvDraftRow = ApEnvVar & AddDbDsnReferenceIntentDraftMetadata;
export type ApEnvResolvedValueResolver = (name: string) => Promise<string>;

export const ENV_EDITOR_MODE_TOGGLE_OPTIONS = [
  {
    ariaLabel: "List environment editor",
    label: "List",
    value: "structured",
  },
  {
    ariaLabel: "Raw environment editor",
    label: "Raw",
    value: "raw",
  },
] as const satisfies readonly SlidingToggleOption<EnvEditorMode>[];

const DB_REFERENCE_FIELD_LABELS: Record<ApEnvDbReferenceField, string> = {
  host: "Host",
  password: "Password",
  port: "Port",
  private: "Private DSN",
  public: "Public DSN",
  username: "Username",
};
// Sized to this editor's own rows; DB connection rows keep a separate, wider
// mask — ADR-0055 shares the reveal interaction between them, not this string.
const MASKED_ENV_VALUE = "*******";
function envDbDsnFieldLabel(field: ApEnvDbReferenceField): string {
  return DB_REFERENCE_FIELD_LABELS[field];
}

function envRowDisplayValue(row: ApEnvVar): string {
  if (row.valueSource === "dbDsn" && row.dbDsn != null) {
    return `${row.dbDsn.dbName} ${envDbDsnFieldLabel(row.dbDsn.field)}`;
  }
  return row.valueSource === "valueFrom" ? "External reference" : row.value;
}

function envRowKey(row: ApEnvVar, index: number): string {
  return [
    index,
    row.name,
    row.value,
    row.valueSource ?? "direct",
    row.valueFrom == null ? "" : JSON.stringify(row.valueFrom),
  ].join("\u0000");
}

export function nextEnvDraftKey(
  prefix: string,
  counter: { current: number }
): string {
  const key = `${prefix}-${counter.current}`;
  counter.current += 1;
  return key;
}

export function createEnvDraftKeys(
  count: number,
  prefix: string,
  counter: { current: number }
): string[] {
  return Array.from({ length: count }, () => nextEnvDraftKey(prefix, counter));
}

export function resizeEnvDraftKeys(
  keys: readonly string[],
  count: number,
  prefix: string,
  counter: { current: number }
): string[] {
  if (keys.length === count) {
    return [...keys];
  }
  if (keys.length > count) {
    return keys.slice(0, count);
  }
  return [...keys, ...createEnvDraftKeys(count - keys.length, prefix, counter)];
}

export function envDraftRowsFromRawSource(source: string): EnvDraftRow[] {
  return apEnvRawSourceRows(source);
}

export function envDraftRowsFromRawParse(
  result: ReturnType<typeof parseApEnvRawSource>
): EnvDraftRow[] {
  return apEnvRawAssignmentsToRows(result.rows);
}

function ExternalEnvBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} variant="outline">
      External
    </Badge>
  );
}

function ReferenceEnvBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} variant="outline">
      Reference
    </Badge>
  );
}

function dbDsnSourceKey(source: ApEnvDbDsnSource): string {
  return apEnvDbSourceKey(source);
}

function dbIdentityForEnvName(source: ApEnvDbDsnSource): string {
  const identity = source.name
    .trim()
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return identity === "" ? "DB" : identity;
}

function nextAvailableEnvName(
  rows: readonly Pick<ApEnvVar, "name">[],
  baseName: string
): string {
  const used = new Set(rows.map((row) => row.name.trim()).filter(Boolean));
  if (!used.has(baseName)) {
    return baseName;
  }
  let suffix = 2;
  while (used.has(`${baseName}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}_${suffix}`;
}

function defaultDatabaseUrlReferenceRowName(
  rows: readonly ApEnvVar[],
  source: ApEnvDbDsnSource
): string {
  const primary = "DATABASE_URL";
  const used = new Set(rows.map((row) => row.name.trim()).filter(Boolean));
  if (!used.has(primary)) {
    return primary;
  }
  return nextAvailableEnvName(
    rows,
    `${dbIdentityForEnvName(source)}_${primary}`
  );
}

function dbDsnSourceMatchesTarget(
  source: ApEnvDbDsnSource,
  target: ApEnvDbDsnReferenceTarget
): boolean {
  return source.name === target.name && source.namespace === target.namespace;
}

function addDbDsnReferenceIntentTarget(
  intent: ApSettingsAddDbDsnReferenceIntent
): ApEnvDbDsnReferenceTarget {
  return { name: intent.dbName, namespace: intent.dbNamespace };
}

export function dbDsnSourceFromAddReferenceIntent(
  sources: readonly ApEnvDbDsnSource[],
  intent: ApSettingsAddDbDsnReferenceIntent | null | undefined
): ApEnvDbDsnSource | undefined {
  if (intent == null) {
    return undefined;
  }
  const target = addDbDsnReferenceIntentTarget(intent);
  return sources.find((source) => dbDsnSourceMatchesTarget(source, target));
}

function appendDbDsnReferenceIntentRow(
  rows: readonly ApEnvVar[],
  source: ApEnvDbDsnSource,
  intent: ApSettingsAddDbDsnReferenceIntent
): EnvDraftRow[] {
  return [
    ...rows,
    {
      canvasAddDbDsnReferenceIntentId: intent.id,
      name: defaultDatabaseUrlReferenceRowName(rows, source),
      referenceDbKey: dbDsnSourceKey(source),
      value: `\${{${source.name}.DATABASE_URL}}`,
    },
  ];
}

export function envRawSourceDraftWithAddReferenceIntent({
  intent,
  rawSource,
  readOnly,
  sources,
}: {
  intent: ApSettingsAddDbDsnReferenceIntent | null | undefined;
  rawSource: string;
  readOnly: boolean;
  sources: readonly ApEnvDbDsnSource[];
}): {
  consumedIntentId?: string;
  rawSource: string;
  rows: EnvDraftRow[];
} {
  const rows = envDraftRowsFromRawSource(rawSource);
  if (intent == null || readOnly) {
    return { rawSource, rows };
  }
  const source = dbDsnSourceFromAddReferenceIntent(sources, intent);
  if (source === undefined) {
    return { consumedIntentId: intent.id, rawSource, rows };
  }

  const referenceRow = appendDbDsnReferenceIntentRow(rows, source, intent).at(
    -1
  );
  if (referenceRow === undefined) {
    return { consumedIntentId: intent.id, rawSource, rows };
  }

  const parsed = appendApEnvRawSourceRow(rawSource, {
    name: referenceRow.name,
    value: referenceRow.value,
  });
  const parsedRows = envDraftRowsFromRawParse(parsed);
  const lastParsedRow = parsedRows.at(-1);
  if (lastParsedRow === undefined) {
    return { consumedIntentId: intent.id, rawSource, rows };
  }
  parsedRows[parsedRows.length - 1] = {
    ...lastParsedRow,
    canvasAddDbDsnReferenceIntentId: intent.id,
    referenceDbKey: dbDsnSourceKey(source),
  };
  return {
    consumedIntentId: intent.id,
    rawSource: parsed.source,
    rows: parsedRows,
  };
}

export function confirmedAddDbDsnReferencesFromEnvDraft(
  rows: readonly ApEnvVar[]
): ApSettingsConfirmedAddDbDsnReference[] {
  const byIntentId = new Map<string, ApSettingsConfirmedAddDbDsnReference>();

  for (const row of rows) {
    const intentId = (row as EnvDraftRow).canvasAddDbDsnReferenceIntentId;
    if (intentId == null || intentId === "") {
      continue;
    }
    if (row.dbDsn != null) {
      byIntentId.set(intentId, {
        dbName: row.dbDsn.dbName,
        dbNamespace: row.dbDsn.dbNamespace,
        id: intentId,
      });
      continue;
    }
    const sourceKey = row.referenceDbKey;
    if (sourceKey == null) {
      continue;
    }
    const slashIndex = sourceKey.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= sourceKey.length - 1) {
      continue;
    }
    byIntentId.set(intentId, {
      dbName: sourceKey.slice(slashIndex + 1),
      dbNamespace: sourceKey.slice(0, slashIndex),
      id: intentId,
    });
  }

  return Array.from(byIntentId.values());
}

function dbReferenceKey(reference: ApSettingsPendingDbReference) {
  return `${reference.dbNamespace}/${reference.dbName}`;
}

function dbReferencesFromRawSource(
  source: string,
  sources: readonly ApEnvDbDsnSource[]
): ApSettingsPendingDbReference[] | undefined {
  const resolved = resolveApEnvRawSourceReferences(source, sources);
  if (!resolved.valid) {
    return undefined;
  }

  const byKey = new Map<string, ApSettingsPendingDbReference>();
  for (const reference of resolved.references) {
    const pendingReference = {
      dbName: reference.canonicalDbName,
      dbNamespace: reference.source.namespace,
    };
    byKey.set(dbReferenceKey(pendingReference), pendingReference);
  }
  return Array.from(byKey.values());
}

export function pendingDbReferencesFromEnvRawSourceDraft({
  committedRawSource,
  draftRawSource,
  sources,
}: {
  committedRawSource: string;
  draftRawSource: string;
  sources: readonly ApEnvDbDsnSource[];
}): ApSettingsPendingDbReference[] | undefined {
  const draftReferences = dbReferencesFromRawSource(draftRawSource, sources);
  if (draftReferences === undefined) {
    return undefined;
  }
  if (draftRawSource === committedRawSource) {
    return [];
  }

  const committedReferences =
    dbReferencesFromRawSource(committedRawSource, sources) ?? [];
  const committedKeys = new Set(committedReferences.map(dbReferenceKey));
  return draftReferences.filter(
    (reference) => !committedKeys.has(dbReferenceKey(reference))
  );
}

export function ReadOnlyEnvRows({ env }: { env: readonly ApEnvVar[] }) {
  return (
    <div
      className="flex max-h-72 w-full flex-col gap-2 overflow-y-auto"
      data-slot="ap-env-rows"
    >
      {env.length === 0 ? (
        <span className="flex min-h-9 w-full items-center justify-center rounded-lg border border-border border-dashed px-3 text-muted-foreground text-xs leading-4">
          No environment variables yet.
        </span>
      ) : (
        env.map((row, index) => (
          <div
            className="grid min-w-0 gap-2 sm:grid-cols-2"
            key={envRowKey(row, index)}
          >
            <span
              className="flex h-9 min-w-0 items-center truncate rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
              title={row.name}
            >
              {row.name}
            </span>
            <span
              className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
              title={envRowDisplayValue(row)}
            >
              <span className="min-w-0 truncate">
                {envRowDisplayValue(row)}
              </span>
              {row.valueSource === "valueFrom" ? (
                <ExternalEnvBadge className="shrink-0" />
              ) : null}
              {row.valueSource === "dbDsn" ? (
                <ReferenceEnvBadge className="shrink-0" />
              ) : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

interface EditableEnvRowsProps {
  copiedValueIndex: number | null;
  dbDsnReferenceSources: ApEnvDbDsnSource[];
  envDirty: boolean;
  envDraft: ApEnvVar[];
  envErrorsByIndex: ReadonlyMap<number, string>;
  envRawSourceDiagnostics: readonly ApEnvRawSourceDiagnostic[];
  envRawSourceDraft: string;
  envRowKeys: readonly string[];
  envTokenDiagnostics: readonly EnvTokenDiagnostic[];
  envValidation: ReturnType<typeof validateApEnvRows>;
  expandedKeys: readonly string[];
  mode: EnvEditorMode;
  onCancelRow: (index: number) => void;
  onCopyResolvedValue: (index: number) => void;
  onDeleteRow: (index: number) => void;
  onEditRow: (index: number) => void;
  onRawSourceChange: (source: string) => void;
  onRevealResolvedValue: (index: number) => void;
  onSaveRow: (index: number) => void;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  resolvedValuesAvailable: boolean;
  revealedValues: ReadonlyMap<number, string>;
  savedRows: readonly ApEnvVar[];
  submitBlocked: boolean;
}

interface EnvRawSourceEditorProps {
  dbDsnReferenceSources: ApEnvDbDsnSource[];
  diagnostic?: ApEnvRawSourceDiagnostic;
  onChange: (source: string) => void;
  value: string;
}

interface EditableEnvNameControlProps {
  error?: string;
  index: number;
  managed?: boolean;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  row: ApEnvVar;
}

interface EditableEnvValueControlProps {
  dbDsnReferenceSources: ApEnvDbDsnSource[];
  index: number;
  managed?: boolean;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  row: ApEnvVar;
}

interface SavedEnvValueControlProps {
  copied?: boolean;
  index: number;
  onCopyResolvedValue: (index: number) => void;
  onRevealResolvedValue: (index: number) => void;
  resolvedValuesAvailable: boolean;
  revealedValue?: string;
  row: ApEnvVar;
}

interface EnvRowActionsMenuProps {
  canEdit: boolean;
  index: number;
  onDeleteRow: (index: number) => void;
  onEditRow: (index: number) => void;
  row: ApEnvVar;
}

function envRowIsManagedHelper(row: ApEnvVar): boolean {
  return row.helper?.automatic === true;
}

function envRowUsesExternalValue(row: ApEnvVar): boolean {
  return row.valueFrom != null || row.valueSource === "valueFrom";
}

function SavedEnvNameControl({ row }: { row: ApEnvVar }) {
  return (
    <div
      className="flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
      title={row.name}
    >
      <span className="min-w-0 truncate">{row.name}</span>
    </div>
  );
}

function configureApEnvRawSourceMonaco(monaco: Monaco) {
  if (apEnvRawSourceMonacoConfigured) {
    return;
  }
  if (
    !monaco.languages
      .getLanguages()
      .some(
        (language: { id: string }) =>
          language.id === AP_ENV_RAW_SOURCE_MONACO_LANGUAGE
      )
  ) {
    monaco.languages.register({ id: AP_ENV_RAW_SOURCE_MONACO_LANGUAGE });
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
  apEnvRawSourceMonacoConfigured = true;
}

function sortedAvailableReferenceItems(
  sources: readonly ApEnvDbDsnSource[]
): ApEnvReferenceMenuItem[] {
  return buildApEnvReferenceMenuItems(sources)
    .filter((item) => item.available)
    .sort((left, right) => {
      const leftOrder =
        AP_ENV_REFERENCE_VARIABLE_SORT_ORDER[left.variableName] ?? 99;
      const rightOrder =
        AP_ENV_REFERENCE_VARIABLE_SORT_ORDER[right.variableName] ?? 99;
      return (
        leftOrder - rightOrder ||
        left.dbName.localeCompare(right.dbName) ||
        left.variableName.localeCompare(right.variableName)
      );
    });
}

function referenceCompletionDocumentation(
  item: ApEnvReferenceMenuItem
): string {
  return (
    AP_ENV_REFERENCE_VARIABLE_DESCRIPTIONS[item.variableName] ??
    item.description
  );
}

function availableReferencePickerItems(
  sources: readonly ApEnvDbDsnSource[]
): ApEnvReferenceMenuItem[] {
  return buildApEnvReferenceMenuItems(sources).filter((item) => item.available);
}

function referencePickerItemMatchesQuery(
  item: ApEnvReferenceMenuItem,
  query: string
): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(REFERENCE_PICKER_QUERY_SPLIT_RE)
    .filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }
  const fields = [
    item.dbName,
    item.variableName,
    item.expression,
    item.type,
    referenceCompletionDocumentation(item),
  ].map((field) => field.toLowerCase());
  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

function groupedReferencePickerItems(
  items: readonly ApEnvReferenceMenuItem[],
  query: string
): { dbName: string; items: ApEnvReferenceMenuItem[] }[] {
  const groups: { dbName: string; items: ApEnvReferenceMenuItem[] }[] = [];
  const groupByDb = new Map<
    string,
    { dbName: string; items: ApEnvReferenceMenuItem[] }
  >();
  for (const item of items) {
    if (!referencePickerItemMatchesQuery(item, query)) {
      continue;
    }
    let group = groupByDb.get(item.dbName);
    if (group === undefined) {
      group = { dbName: item.dbName, items: [] };
      groupByDb.set(item.dbName, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

function syncApEnvRawSourceMarkers({
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
    AP_ENV_RAW_SOURCE_MARKER_OWNER,
    diagnostics.map((diagnostic) => {
      const lineCount = model.getLineCount();
      const line = Math.max(1, Math.min(lineCount, diagnostic.line));
      return {
        endColumn: model.getLineMaxColumn(line),
        endLineNumber: line,
        message: diagnostic.message,
        severity: monaco.MarkerSeverity.Error,
        source: AP_ENV_RAW_SOURCE_MARKER_OWNER,
        startColumn: 1,
        startLineNumber: line,
      };
    })
  );
}

function EditableEnvNameControl({
  error,
  index,
  managed = false,
  onUpdateRow,
  row,
}: EditableEnvNameControlProps) {
  if (managed) {
    return (
      <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-white/5 px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">{row.name}</span>
      </div>
    );
  }

  return (
    <AppInput
      aria-invalid={error != null}
      aria-label="Environment variable name"
      onChange={(event) =>
        onUpdateRow(index, {
          name: event.target.value,
        })
      }
      placeholder="Name"
      value={row.name}
    />
  );
}

function EditableEnvValueControl({
  dbDsnReferenceSources,
  index,
  managed = false,
  onUpdateRow,
  row,
}: EditableEnvValueControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [referenceQuery, setReferenceQuery] = useState("");
  const externalValue = envRowUsesExternalValue(row);
  if (managed) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-white/5 px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">
          {externalValue ? "External reference" : row.value}
        </span>
        {externalValue ? <ExternalEnvBadge className="shrink-0" /> : null}
      </div>
    );
  }

  if (externalValue) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">External reference</span>
        <ExternalEnvBadge className="shrink-0" />
      </div>
    );
  }

  const menuItems = availableReferencePickerItems(dbDsnReferenceSources);
  const visibleGroups = groupedReferencePickerItems(menuItems, referenceQuery);
  const canInsertReference = menuItems.length > 0;
  const handleReferenceMenuOpenChange = (open: boolean) => {
    setReferenceMenuOpen(open);
    if (!open) {
      setReferenceQuery("");
    }
  };
  const handleInsertReference = (expression: string) => {
    const nextValue = insertApEnvReferenceText(
      row.value,
      expression,
      inputRef.current?.selectionStart,
      inputRef.current?.selectionEnd
    );
    onUpdateRow(index, {
      value: nextValue,
      valueSource: "direct",
    });
    setReferenceMenuOpen(false);
    setReferenceQuery("");
  };

  return (
    <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent focus-within:border-blue-400 focus-within:ring-[1px] focus-within:ring-blue-400/50">
      <AppInput
        aria-label="Environment variable value"
        className="border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
        onChange={(event) => {
          const nextValue = event.target.value;
          if (canInsertReference && nextValue.includes("${{")) {
            setReferenceMenuOpen(true);
          }
          onUpdateRow(index, {
            value: nextValue,
            valueSource: "direct",
          });
        }}
        placeholder="Value"
        ref={inputRef}
        value={row.value}
        variant="bare"
      />
      <Popover
        onOpenChange={handleReferenceMenuOpenChange}
        open={referenceMenuOpen}
      >
        <PopoverTrigger
          render={
            <AppIconButton
              aria-label="Insert environment reference token"
              className="mr-1 rounded-md"
              data-slot="ap-env-token-trigger"
              disabled={!canInsertReference}
              size="sm"
              title="Insert reference token"
              type="button"
              variant="secondary"
            >
              <Braces aria-hidden className="size-4" />
            </AppIconButton>
          }
        />
        <PopoverContent
          align="end"
          className="w-80 gap-0 rounded-md border border-border bg-input/30 p-0 shadow-none ring-0 backdrop-blur-xl"
          sideOffset={6}
        >
          <div
            className="relative flex h-10 items-center border-border border-b px-3"
            data-slot="ap-env-reference-search"
          >
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            />
            <input
              aria-label="Search DB references"
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent pl-6 font-medium text-muted-foreground text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setReferenceQuery(event.target.value)}
              placeholder="Search"
              type="search"
              value={referenceQuery}
            />
          </div>
          <div
            className="max-h-72 overflow-y-auto p-1"
            data-slot="ap-env-reference-results"
            role="listbox"
          >
            {visibleGroups.length === 0 ? (
              <div
                className="px-2 py-6 text-center text-muted-foreground text-sm"
                data-slot="ap-env-reference-no-results"
              >
                No references found.
              </div>
            ) : (
              visibleGroups.map((group) => (
                <div
                  className="grid gap-1 py-1 first:pt-0 last:pb-0"
                  data-slot="ap-env-reference-group"
                  key={group.dbName}
                >
                  <div className="px-2 py-1 text-muted-foreground text-xs">
                    {group.dbName}
                  </div>
                  {group.items.map((item) => (
                    <button
                      className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-input focus-visible:bg-input"
                      data-slot="ap-env-reference-item"
                      key={`${item.dbName}-${item.variableName}`}
                      onClick={() => handleInsertReference(item.expression)}
                      role="option"
                      type="button"
                    >
                      <span className="grid min-w-0 flex-1">
                        <span className="min-w-0 truncate font-medium">
                          {item.variableName}
                        </span>
                        <span className="min-w-0 truncate text-muted-foreground text-xs">
                          {referenceCompletionDocumentation(item)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SavedEnvValueControl({
  copied = false,
  index,
  onCopyResolvedValue,
  onRevealResolvedValue,
  revealedValue,
  resolvedValuesAvailable,
  row,
}: SavedEnvValueControlProps) {
  const displayValue = resolvedValuesAvailable
    ? (revealedValue ?? MASKED_ENV_VALUE)
    : envRowDisplayValue(row);
  const revealed = resolvedValuesAvailable && revealedValue !== undefined;
  const revealIcon = revealed ? (
    <EyeClosed aria-hidden className="size-4" />
  ) : (
    <Eye aria-hidden className="size-4" />
  );
  const copyIcon = copied ? (
    <Check aria-hidden className="size-4" />
  ) : (
    <Copy aria-hidden className="size-4" />
  );
  return (
    <div className="flex h-9 min-w-0 items-center gap-1 rounded-md border border-input bg-transparent py-0 pr-1 pl-3 text-foreground text-sm leading-5">
      <span className="min-w-0 flex-1 truncate" title={displayValue}>
        {displayValue}
      </span>
      {resolvedValuesAvailable ? (
        <>
          <AppIconButton
            aria-label={`${revealed ? "Hide" : "Reveal"} environment variable ${row.name}`}
            aria-pressed={revealed}
            className="text-muted-foreground hover:text-foreground"
            onClick={() => onRevealResolvedValue(index)}
            size="sm"
            type="button"
            variant="quiet"
          >
            {revealIcon}
          </AppIconButton>
          <AppIconButton
            aria-label={`${copied ? "Copied" : "Copy"} environment variable ${row.name}`}
            className={cn(
              "text-muted-foreground hover:text-foreground",
              copied && "text-foreground"
            )}
            onClick={() => onCopyResolvedValue(index)}
            size="sm"
            type="button"
            variant="quiet"
          >
            {copyIcon}
          </AppIconButton>
        </>
      ) : null}
    </div>
  );
}

function CollapsedDirtyEnvValue({ row }: { row: ApEnvVar }) {
  return (
    <div
      className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
      title={envRowDisplayValue(row)}
    >
      <span className="min-w-0 truncate">{envRowDisplayValue(row)}</span>
      {row.valueSource === "valueFrom" ? (
        <ExternalEnvBadge className="shrink-0" />
      ) : null}
      {row.valueSource === "dbDsn" ? (
        <ReferenceEnvBadge className="shrink-0" />
      ) : null}
    </div>
  );
}

function EnvRowEditActions({
  canSave,
  index,
  onCancelRow,
  onSaveRow,
  rowName,
  submitBlocked,
}: {
  canSave: boolean;
  index: number;
  onCancelRow: (index: number) => void;
  onSaveRow: (index: number) => void;
  rowName: string;
  submitBlocked: boolean;
}) {
  const label = rowName.trim() === "" ? "new" : rowName;
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <AppButton
          aria-label={`Discard ${label} environment variable edit`}
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={() => onCancelRow(index)}
          size="lg"
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          aria-label={`Confirm ${label} environment variable`}
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={!canSave}
          onClick={() => onSaveRow(index)}
          size="lg"
          type="button"
          variant="quiet"
        >
          <Save aria-hidden data-icon="inline-start" />
          Save
        </AppButton>
      </div>
      {submitBlocked && canSave ? (
        <p className="text-muted-foreground text-xs">
          Save or cancel this variable before updating.
        </p>
      ) : null}
    </>
  );
}

function EnvRowActionsMenu({
  canEdit,
  index,
  onDeleteRow,
  onEditRow,
  row,
}: EnvRowActionsMenuProps) {
  return (
    <CanvasNode.ActionMenu
      alignOffset={0}
      aria-label={`Environment variable actions for ${row.name}`}
      className="bg-input/30 hover:bg-input! data-popup-open:bg-input! data-popup-open:text-blue-400"
      sideOffset={6}
      triggerSize="lg"
      triggerVariant="secondary"
    >
      {canEdit ? (
        <CanvasNode.ActionMenuItem
          action={{ onClick: () => onEditRow(index) }}
          actionKey="edit"
          icon={<SquarePen aria-hidden className="size-4" />}
        >
          Edit
        </CanvasNode.ActionMenuItem>
      ) : null}
      <CanvasNode.ActionMenuItem
        action={{ onClick: () => onDeleteRow(index) }}
        actionKey="delete"
        icon={<Trash2 aria-hidden className="size-4" />}
        tone="destructive"
      >
        Delete
      </CanvasNode.ActionMenuItem>
    </CanvasNode.ActionMenu>
  );
}

function EnvRawSourceEditor({
  dbDsnReferenceSources,
  diagnostic,
  onChange,
  value,
}: EnvRawSourceEditorProps) {
  const editorId = useId();
  const editorInstanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const completionProviderRef = useRef<IDisposable | null>(null);
  const diagnosticsRef = useRef<readonly ApEnvRawSourceDiagnostic[]>([]);
  const menuItems = useMemo(
    () => sortedAvailableReferenceItems(dbDsnReferenceSources),
    [dbDsnReferenceSources]
  );
  const menuItemsRef = useRef(menuItems);
  const editorPath = useMemo(
    () => `inmemory://ap-env-raw-source/${encodeURIComponent(editorId)}.env`,
    [editorId]
  );
  const diagnostics = useMemo(
    () => (diagnostic == null ? [] : [diagnostic]),
    [diagnostic]
  );
  diagnosticsRef.current = diagnostics;
  menuItemsRef.current = menuItems;

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
          suggestions: menuItemsRef.current.map((item, index) => {
            const fieldOrder =
              AP_ENV_REFERENCE_VARIABLE_SORT_ORDER[item.variableName] ?? 99;
            const sortText = `${String(fieldOrder).padStart(2, "0")}-${
              item.dbName
            }-${String(index).padStart(3, "0")}`;
            return {
              detail: item.dbName,
              documentation: referenceCompletionDocumentation(item),
              filterText: item.expression,
              insertText: item.expression,
              kind: monaco.languages.CompletionItemKind.Reference,
              label: {
                description: item.dbName,
                label: item.variableName,
              },
              range,
              sortText,
            };
          }),
        };
      },
      triggerCharacters: ["{"],
    };
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider(
        AP_ENV_RAW_SOURCE_MONACO_LANGUAGE,
        completionProvider
      );
    syncApEnvRawSourceMarkers({
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
    syncApEnvRawSourceMarkers({
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
            beforeMount={configureApEnvRawSourceMonaco}
            defaultLanguage={AP_ENV_RAW_SOURCE_MONACO_LANGUAGE}
            height="12rem"
            keepCurrentModel={false}
            language={AP_ENV_RAW_SOURCE_MONACO_LANGUAGE}
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

interface DraftEnvRowProps {
  copied: boolean;
  dbDsnReferenceSources: ApEnvDbDsnSource[];
  error?: string;
  expanded: boolean;
  index: number;
  onCancelRow: (index: number) => void;
  onCopyResolvedValue: (index: number) => void;
  onDeleteRow: (index: number) => void;
  onEditRow: (index: number) => void;
  onRevealResolvedValue: (index: number) => void;
  onSaveRow: (index: number) => void;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  resolvedValuesAvailable: boolean;
  revealedValue?: string;
  row: ApEnvVar;
  savedRow?: ApEnvVar;
  submitBlocked: boolean;
}

function CollapsedEnvNameControl({
  clean,
  index,
  managed,
  onUpdateRow,
  row,
}: {
  clean: boolean;
  index: number;
  managed: boolean;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  row: ApEnvVar;
}) {
  if (managed && !clean) {
    return (
      <EditableEnvNameControl
        index={index}
        managed
        onUpdateRow={onUpdateRow}
        row={row}
      />
    );
  }
  return <SavedEnvNameControl row={row} />;
}

function CollapsedEnvValueControl({
  clean,
  copied,
  dbDsnReferenceSources,
  index,
  managed,
  onCopyResolvedValue,
  onRevealResolvedValue,
  onUpdateRow,
  resolvedValuesAvailable,
  revealedValue,
  row,
}: {
  clean: boolean;
  copied: boolean;
  dbDsnReferenceSources: ApEnvDbDsnSource[];
  index: number;
  managed: boolean;
  onCopyResolvedValue: (index: number) => void;
  onRevealResolvedValue: (index: number) => void;
  onUpdateRow: (index: number, patch: Partial<ApEnvRow>) => void;
  resolvedValuesAvailable: boolean;
  revealedValue?: string;
  row: ApEnvVar;
}) {
  if (clean) {
    return (
      <SavedEnvValueControl
        copied={copied}
        index={index}
        onCopyResolvedValue={onCopyResolvedValue}
        onRevealResolvedValue={onRevealResolvedValue}
        resolvedValuesAvailable={resolvedValuesAvailable}
        revealedValue={revealedValue}
        row={row}
      />
    );
  }
  if (managed) {
    return (
      <EditableEnvValueControl
        dbDsnReferenceSources={dbDsnReferenceSources}
        index={index}
        managed
        onUpdateRow={onUpdateRow}
        row={row}
      />
    );
  }
  return <CollapsedDirtyEnvValue row={row} />;
}

function CollapsedEnvTrailing({
  index,
  managed,
  onDeleteRow,
  onEditRow,
  row,
}: {
  index: number;
  managed: boolean;
  onDeleteRow: (index: number) => void;
  onEditRow: (index: number) => void;
  row: ApEnvVar;
}) {
  if (managed) {
    return <div aria-hidden className="size-9" />;
  }
  return (
    <EnvRowActionsMenu
      canEdit
      index={index}
      onDeleteRow={onDeleteRow}
      onEditRow={onEditRow}
      row={row}
    />
  );
}

function DraftEnvRow({
  copied,
  dbDsnReferenceSources,
  error,
  expanded,
  index,
  onCancelRow,
  onCopyResolvedValue,
  onDeleteRow,
  onEditRow,
  onRevealResolvedValue,
  onSaveRow,
  onUpdateRow,
  resolvedValuesAvailable,
  revealedValue,
  row,
  savedRow,
  submitBlocked,
}: DraftEnvRowProps) {
  const managed = envRowIsManagedHelper(row);
  const open = !managed && expanded;
  const errorNode =
    error == null ? null : (
      <p className="text-destructive text-xs" role="status">
        {error}
      </p>
    );

  if (open) {
    return (
      <div
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border border-dashed bg-transparent p-3"
        data-env-row="editing"
      >
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <EditableEnvNameControl
            error={error}
            index={index}
            onUpdateRow={onUpdateRow}
            row={row}
          />
          <EditableEnvValueControl
            dbDsnReferenceSources={dbDsnReferenceSources}
            index={index}
            onUpdateRow={onUpdateRow}
            row={row}
          />
        </div>
        {errorNode}
        <EnvRowEditActions
          canSave={error == null && row.name.trim() !== ""}
          index={index}
          onCancelRow={onCancelRow}
          onSaveRow={onSaveRow}
          rowName={row.name}
          submitBlocked={submitBlocked}
        />
      </div>
    );
  }

  const clean = savedRow != null && apEnvRowsModelEqual([row], [savedRow]);
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem]">
        <CollapsedEnvNameControl
          clean={clean}
          index={index}
          managed={managed}
          onUpdateRow={onUpdateRow}
          row={row}
        />
        <CollapsedEnvValueControl
          clean={clean}
          copied={copied}
          dbDsnReferenceSources={dbDsnReferenceSources}
          index={index}
          managed={managed}
          onCopyResolvedValue={onCopyResolvedValue}
          onRevealResolvedValue={onRevealResolvedValue}
          onUpdateRow={onUpdateRow}
          resolvedValuesAvailable={resolvedValuesAvailable}
          revealedValue={revealedValue}
          row={row}
        />
        <CollapsedEnvTrailing
          index={index}
          managed={managed}
          onDeleteRow={onDeleteRow}
          onEditRow={onEditRow}
          row={row}
        />
      </div>
      {errorNode}
    </div>
  );
}

export function EditableEnvRows({
  copiedValueIndex,
  dbDsnReferenceSources,
  envDirty,
  envDraft,
  envErrorsByIndex,
  envRawSourceDraft,
  envRawSourceDiagnostics,
  envRowKeys,
  envTokenDiagnostics = [],
  envValidation,
  expandedKeys,
  mode,
  onCancelRow,
  onCopyResolvedValue,
  onDeleteRow,
  onEditRow,
  onRawSourceChange,
  onRevealResolvedValue,
  onSaveRow,
  onUpdateRow,
  revealedValues,
  resolvedValuesAvailable,
  savedRows,
  submitBlocked,
}: EditableEnvRowsProps) {
  const firstRawSourceDiagnostic = envRawSourceDiagnostics[0];
  let editorContent: ReactNode;
  if (mode === "raw") {
    editorContent = (
      <EnvRawSourceEditor
        dbDsnReferenceSources={dbDsnReferenceSources}
        diagnostic={firstRawSourceDiagnostic}
        onChange={onRawSourceChange}
        value={envRawSourceDraft}
      />
    );
  } else if (envDraft.length === 0) {
    editorContent = (
      <div className="flex min-h-9 w-full items-center justify-center rounded-lg border border-border border-dashed px-3 text-muted-foreground text-xs leading-4">
        No environment variables yet.
      </div>
    );
  } else {
    editorContent = envDraft.map((row, index) => {
      const rowKey = envRowKeys[index] ?? envRowKey(row, index);
      return (
        <DraftEnvRow
          copied={copiedValueIndex === index}
          dbDsnReferenceSources={dbDsnReferenceSources}
          error={envErrorsByIndex.get(index)}
          expanded={expandedKeys.includes(rowKey)}
          index={index}
          key={rowKey}
          onCancelRow={onCancelRow}
          onCopyResolvedValue={onCopyResolvedValue}
          onDeleteRow={onDeleteRow}
          onEditRow={onEditRow}
          onRevealResolvedValue={onRevealResolvedValue}
          onSaveRow={onSaveRow}
          onUpdateRow={onUpdateRow}
          resolvedValuesAvailable={resolvedValuesAvailable}
          revealedValue={revealedValues.get(index)}
          row={row}
          savedRow={savedRows[index]}
          submitBlocked={submitBlocked}
        />
      );
    });
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2",
        mode === "raw" ? "overflow-visible" : "max-h-72 overflow-y-auto"
      )}
      data-slot="ap-env-rows"
    >
      {editorContent}
      {mode === "structured" && !envValidation.valid && envDirty ? (
        <p className="text-destructive text-xs" role="status">
          Fix environment variable names before saving.
        </p>
      ) : null}
      {mode === "structured" && envRawSourceDiagnostics.length > 0 ? (
        <p className="text-destructive text-xs" role="status">
          Raw source has errors. Open Raw to fix it.
        </p>
      ) : null}
      {mode === "structured" && envTokenDiagnostics.length === 0 ? null : (
        <p className="text-destructive text-xs" role="status">
          {envTokenDiagnostics[0]?.message}
        </p>
      )}
    </div>
  );
}
