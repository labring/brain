"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Label } from "@workspace/ui/components/label";
import { ResourceSettingsDraftFooter } from "@workspace/ui/components/resource-settings/resource-settings";
import { Textarea } from "@workspace/ui/components/textarea";
import { appFieldFocusClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import { Plus, Save, SquarePen, Trash2, X } from "lucide-react";
import type { ComponentProps } from "react";
import {
  isStorageShrink,
  maxGiForStorage,
  parseStorageSizeToGi,
} from "@/components/storage-size";
import { StorageSizeInput } from "@/components/storage-size-input";

export interface ApConfigMapMount {
  path: string;
  value: string;
}

export interface ApStorageMount {
  path: string;
  size: string;
}

export type ApWorkloadKind = "deployment" | "statefulset";

export function ImageSettingsContent({
  imageInputId,
  onBlur,
  onChange,
  readOnly,
  value,
}: {
  imageInputId: string;
  onBlur: () => void;
  onChange: (image: string) => void;
  readOnly: boolean;
  value: string;
}) {
  const shownImage = value.trim() === "" ? "No image configured" : value;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label
        className="text-foreground text-sm leading-none"
        htmlFor={imageInputId}
      >
        Image
      </Label>
      {readOnly ? (
        <div
          className="flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-muted-foreground text-sm leading-5"
          title={shownImage}
        >
          <span className="min-w-0 truncate">{shownImage}</span>
        </div>
      ) : (
        <AppInput
          aria-label="AP image"
          id={imageInputId}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ghcr.io/org/app:1.0.0"
          title={shownImage}
          value={value}
        />
      )}
    </div>
  );
}

export function normalizeCommandDraftLines(
  value: readonly string[] | undefined
): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

export function normalizeConfigMapDraftRows(
  value: readonly ApConfigMapMount[] | undefined
): ApConfigMapMount[] {
  return (value ?? [])
    .map((item) => ({
      path: item.path.trim(),
      value: item.value,
    }))
    .filter((item) => item.path !== "" || item.value !== "");
}

export function normalizeStorageDraftRows(
  value: readonly ApStorageMount[] | undefined
): ApStorageMount[] {
  return (value ?? [])
    .map((item) => ({
      path: item.path.trim(),
      size: item.size.trim(),
    }))
    .filter((item) => item.path !== "" || item.size !== "");
}

function splitDraftLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ApSettingsTextarea({
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        "min-h-20 border-input bg-transparent text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
        appFieldFocusClass,
        className
      )}
      {...props}
    />
  );
}

export function LaunchCommandSettingsContent({
  args,
  command,
  onArgsChange,
  onCommandChange,
  readOnly,
}: {
  args: readonly string[];
  command: readonly string[];
  onArgsChange: (value: readonly string[]) => void;
  onCommandChange: (value: readonly string[]) => void;
  readOnly: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      <div className="grid min-w-0 gap-2">
        <Label className="text-foreground text-sm leading-none">Command</Label>
        <ApSettingsTextarea
          aria-label="AP command"
          onChange={(event) =>
            onCommandChange(splitDraftLines(event.target.value))
          }
          placeholder="/app/server"
          readOnly={readOnly}
          value={command.join("\n")}
        />
      </div>
      <div className="grid min-w-0 gap-2">
        <Label className="text-foreground text-sm leading-none">
          Arguments
        </Label>
        <ApSettingsTextarea
          aria-label="AP arguments"
          onChange={(event) =>
            onArgsChange(splitDraftLines(event.target.value))
          }
          placeholder={"--config\n/etc/app/config.yaml"}
          readOnly={readOnly}
          value={args.join("\n")}
        />
      </div>
    </div>
  );
}

/**
 * Mount paths that appear on more than one AP Configuration File draft row.
 * The trimmed mount path is the file's identifying key, so a repeated path is
 * a conflict that blocks saving the affected card.
 */
export function configMapDuplicatePaths(
  rows: readonly ApConfigMapMount[]
): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const path = row.path.trim();
    if (path === "") {
      continue;
    }
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [path, count] of counts) {
    if (count > 1) {
      duplicates.add(path);
    }
  }
  return duplicates;
}

/** First non-empty line of a config file's content, used for the read view. */
export function configFileContentPreview(value: string): string {
  return (
    value
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

function configMapPathError({
  trimmedPath,
  isDuplicate,
  hasContent,
  submitBlocked,
}: {
  trimmedPath: string;
  isDuplicate: boolean;
  hasContent: boolean;
  submitBlocked: boolean;
}): string | null {
  if (isDuplicate) {
    return "This mount path is already in use.";
  }
  if (trimmedPath === "" && (hasContent || submitBlocked)) {
    return "Mount path is required.";
  }
  return null;
}

function ConfigMapCollapsedCard({
  index,
  item,
  onDelete,
  onEdit,
  readOnly,
}: {
  index: number;
  item: ApConfigMapMount;
  onDelete: (index: number) => void;
  onEdit: (index: number) => void;
  readOnly: boolean;
}) {
  const preview = configFileContentPreview(item.value);
  return (
    <div
      className="flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2"
      data-config-card="collapsed"
    >
      <div className="grid min-w-0 flex-1 gap-2">
        <div
          className="truncate text-foreground text-sm leading-5"
          title={item.path}
        >
          {item.path}
        </div>
        <div
          className="truncate text-muted-foreground text-sm leading-5"
          title={preview}
        >
          {preview === "" ? "Empty file" : preview}
        </div>
      </div>
      {readOnly ? null : (
        <div className="flex shrink-0 items-center gap-2">
          <AppIconButton
            aria-label="Edit configuration file"
            onClick={() => onEdit(index)}
            size="lg"
            title="Edit configuration file"
            type="button"
            variant="secondary"
          >
            <SquarePen aria-hidden />
          </AppIconButton>
          <AppIconButton
            aria-label="Delete configuration file"
            onClick={() => onDelete(index)}
            size="lg"
            title="Delete configuration file"
            type="button"
            variant="danger"
          >
            <Trash2 aria-hidden />
          </AppIconButton>
        </div>
      )}
    </div>
  );
}

function ConfigMapEditingCard({
  duplicatePaths,
  index,
  item,
  onCancel,
  onSave,
  onUpdate,
  submitBlocked,
}: {
  duplicatePaths: ReadonlySet<string>;
  index: number;
  item: ApConfigMapMount;
  onCancel: (index: number) => void;
  onSave: (index: number) => void;
  onUpdate: (index: number, patch: Partial<ApConfigMapMount>) => void;
  submitBlocked: boolean;
}) {
  const trimmedPath = item.path.trim();
  const isDuplicate = trimmedPath !== "" && duplicatePaths.has(trimmedPath);
  const pathError = configMapPathError({
    hasContent: item.value.trim() !== "",
    isDuplicate,
    submitBlocked,
    trimmedPath,
  });
  const canSaveRow = trimmedPath !== "" && !isDuplicate;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-input border-dashed bg-transparent p-3"
      data-config-card="expanded"
    >
      <AppInput
        aria-invalid={pathError != null}
        aria-label="Configuration file mount path"
        onChange={(event) => onUpdate(index, { path: event.target.value })}
        placeholder="/etc/app/config.yaml"
        value={item.path}
      />
      {pathError == null ? null : (
        <p className="text-destructive text-xs" role="status">
          {pathError}
        </p>
      )}
      <ApSettingsTextarea
        aria-label="Configuration file content"
        onChange={(event) => onUpdate(index, { value: event.target.value })}
        placeholder="key: value"
        value={item.value}
      />
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <AppButton
          aria-label="Cancel configuration file changes"
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={() => onCancel(index)}
          size="lg"
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          aria-label="Save configuration file"
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={!canSaveRow}
          onClick={() => onSave(index)}
          size="lg"
          type="button"
          variant="quiet"
        >
          <Save aria-hidden data-icon="inline-start" />
          Save
        </AppButton>
      </div>
      {submitBlocked && canSaveRow ? (
        <p className="text-muted-foreground text-xs">
          Save or cancel this file before updating.
        </p>
      ) : null}
    </div>
  );
}

export function ConfigMapSettingsContent({
  configMaps,
  configMapKeys,
  expandedKeys,
  onAdd,
  onCancel,
  onDelete,
  onEdit,
  onSave,
  onUpdate,
  readOnly,
  submitBlocked,
}: {
  configMaps: readonly ApConfigMapMount[];
  configMapKeys: readonly string[];
  expandedKeys: readonly string[];
  onAdd: () => void;
  onCancel: (index: number) => void;
  onDelete: (index: number) => void;
  onEdit: (index: number) => void;
  onSave: (index: number) => void;
  onUpdate: (index: number, patch: Partial<ApConfigMapMount>) => void;
  readOnly: boolean;
  submitBlocked: boolean;
}) {
  const duplicatePaths = configMapDuplicatePaths(configMaps);
  const expanded = new Set(expandedKeys);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {readOnly ? null : (
        <AppButton
          aria-label="Add configuration file"
          className="h-9 w-full rounded-lg bg-white/5 text-primary text-sm hover:bg-input"
          onClick={onAdd}
          size="default"
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden />
          Add File
        </AppButton>
      )}
      {configMaps.length === 0 ? (
        <div className="flex min-h-9 w-full items-center justify-center rounded-lg border border-border border-dashed px-3 text-muted-foreground text-xs leading-4">
          No config files yet.
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          {configMaps.map((item, index) => {
            const cardKey = configMapKeys[index];
            const key = cardKey ?? `${item.path} ${item.value}`;
            const isExpanded =
              !readOnly && cardKey != null && expanded.has(cardKey);
            return isExpanded ? (
              <ConfigMapEditingCard
                duplicatePaths={duplicatePaths}
                index={index}
                item={item}
                key={key}
                onCancel={onCancel}
                onSave={onSave}
                onUpdate={onUpdate}
                submitBlocked={submitBlocked}
              />
            ) : (
              <ConfigMapCollapsedCard
                index={index}
                item={item}
                key={key}
                onDelete={onDelete}
                onEdit={onEdit}
                readOnly={readOnly}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function StorageSettingsContent({
  currentStorage,
  onUpdate,
  readOnly,
  storage,
  storageKeys,
}: {
  currentStorage: readonly ApStorageMount[];
  onUpdate: (index: number, patch: Partial<ApStorageMount>) => void;
  readOnly: boolean;
  storage: readonly ApStorageMount[];
  storageKeys: readonly string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {storage.length === 0 ? (
        <div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-muted-foreground text-sm leading-5">
          No storage
        </div>
      ) : (
        storage.map((item, index) => {
          const currentSize =
            currentStorage.find((mount) => mount.path === item.path)?.size ??
            item.size;
          const shrink = isStorageShrink(item.size, currentSize);
          const currentGi = parseStorageSizeToGi(currentSize);
          return (
            <div
              className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem]"
              key={storageKeys[index] ?? `${item.path}\u0000${item.size}`}
            >
              <AppInput
                aria-label="Storage mount path"
                readOnly
                title="StatefulSet storage mount path is immutable."
                value={item.path}
              />
              <StorageSizeInput
                aria-invalid={shrink ? true : undefined}
                aria-label="Storage size"
                maxGi={maxGiForStorage(currentSize)}
                minSize={currentSize}
                onChange={(size) => onUpdate(index, { size })}
                readOnly={readOnly}
                value={item.size}
              />
              {shrink ? (
                <p className="text-destructive text-xs leading-4 sm:col-span-2">
                  Volumes can only grow
                  {currentGi === null ? "" : ` — keep at least ${currentGi} Gi`}
                  .
                </p>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

export function ApSettingsDraftFooter({
  canSave,
  conflictMessage,
  dirty,
  discardAriaLabel = "Discard settings changes",
  onCancel,
  onKeepEditing,
  onReload,
  onSave,
  pending,
  saveFailureMessage,
  submitAriaLabel = "Update settings",
  submitLabel,
  unsavedMessage,
}: {
  canSave: boolean;
  conflictMessage?: string | null;
  dirty: boolean;
  discardAriaLabel?: string;
  onCancel: () => void;
  onKeepEditing: () => void;
  onReload: () => void;
  onSave: () => void | Promise<void>;
  pending: boolean;
  saveFailureMessage: string | null;
  submitAriaLabel?: string;
  submitLabel?: string;
  unsavedMessage?: string;
}) {
  return (
    <ResourceSettingsDraftFooter
      cancelAriaLabel={discardAriaLabel}
      canSubmit={canSave}
      className="p-2.5"
      conflictMessage={conflictMessage}
      data-slot="ap-settings-draft-actions"
      dirty={dirty}
      onCancel={onCancel}
      onKeepEditing={onKeepEditing}
      onReload={onReload}
      onSubmit={onSave}
      pending={pending}
      saveFailureMessage={saveFailureMessage}
      submitAriaLabel={submitAriaLabel}
      submitLabel={submitLabel}
      unsavedMessage={unsavedMessage}
    />
  );
}

/**
 * Structured readout for workload settings: AP image, CPU/memory quota sliders,
 * optional replica count, environment variables, and AP Network settings.
 * All fields are controlled by the host.
 */
