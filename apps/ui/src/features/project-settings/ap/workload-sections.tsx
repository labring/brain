"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { Label } from "@workspace/ui/components/label";
import { ResourceSettingsDraftFooter } from "@workspace/ui/components/resource-settings/resource-settings";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import type { ComponentProps } from "react";

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
        "focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50",
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

export function ConfigMapSettingsContent({
  configMaps,
  configMapKeys,
  onAdd,
  onDelete,
  onUpdate,
  readOnly,
}: {
  configMaps: readonly ApConfigMapMount[];
  configMapKeys: readonly string[];
  onAdd: () => void;
  onDelete: (index: number) => void;
  onUpdate: (index: number, patch: Partial<ApConfigMapMount>) => void;
  readOnly: boolean;
}) {
  return (
    <>
      <div className="flex min-w-0 flex-col gap-2">
        {configMaps.length === 0 ? (
          <div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-muted-foreground text-sm leading-5">
            No config files
          </div>
        ) : (
          configMaps.map((item, index) => (
            <div
              className="grid min-w-0 gap-2 rounded-md border border-input bg-transparent p-2"
              key={configMapKeys[index] ?? `${item.path}\u0000${item.value}`}
            >
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_2.25rem]">
                <AppInput
                  aria-label="Config file mount path"
                  onChange={(event) =>
                    onUpdate(index, { path: event.target.value })
                  }
                  placeholder="/etc/app/config.yaml"
                  readOnly={readOnly}
                  value={item.path}
                />
                {readOnly ? (
                  <div aria-hidden className="size-9" />
                ) : (
                  <AppIconButton
                    aria-label="Remove config file"
                    className="hover:text-red-500"
                    onClick={() => onDelete(index)}
                    size="lg"
                    type="button"
                    variant="quiet"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </AppIconButton>
                )}
              </div>
              <ApSettingsTextarea
                aria-label="Config file content"
                onChange={(event) =>
                  onUpdate(index, { value: event.target.value })
                }
                placeholder="key: value"
                readOnly={readOnly}
                value={item.value}
              />
            </div>
          ))
        )}
      </div>
      {readOnly ? null : (
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <AppButton
            aria-label="Add config file"
            className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
            onClick={onAdd}
            size="lg"
            type="button"
            variant="quiet"
          >
            <Plus aria-hidden data-icon="inline-start" />
            Add
          </AppButton>
        </div>
      )}
    </>
  );
}

export function StorageSettingsContent({
  onUpdate,
  readOnly,
  storage,
  storageKeys,
}: {
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
        storage.map((item, index) => (
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
            <AppInput
              aria-label="Storage size"
              onChange={(event) =>
                onUpdate(index, { size: event.target.value })
              }
              placeholder="1Gi"
              readOnly={readOnly}
              value={item.size}
            />
          </div>
        ))
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
