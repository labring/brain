"use client";

import { Button } from "@workspace/ui/components/button";
import { ScaleSlider } from "@workspace/ui/components/scale-slider/scale-slider";
import { cn } from "@workspace/ui/lib/utils";
import { type LucideIcon, Settings2, Upload } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export function ResourceSettingsSection({
  actions,
  children,
  className,
  icon: Icon = Settings2,
  title,
  ...props
}: ComponentPropsWithoutRef<"section"> & {
  actions?: ReactNode;
  icon?: LucideIcon;
  title: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-transparent",
        className
      )}
      {...props}
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-border border-b px-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden className="size-4 shrink-0 text-foreground" />
          <h3 className="truncate font-medium text-foreground text-sm leading-5">
            {title}
          </h3>
        </div>
        {actions == null ? null : (
          <div className="flex shrink-0 items-center gap-1">{actions}</div>
        )}
      </header>
      <div className="flex min-w-0 flex-col gap-3 px-2.5 pb-3">{children}</div>
    </section>
  );
}

export function ResourceSettingsInset({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("rounded-lg bg-white/5 px-3 pt-2.5 pb-3", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ResourceSettingsDraftFooter({
  backingResourceChanged,
  canSubmit,
  cancelAriaLabel = "Cancel settings changes",
  className,
  dirty,
  onCancel,
  onKeepEditing,
  onReload,
  onSubmit,
  pending,
  pendingSubmitLabel = "Updating",
  saveFailureMessage,
  submitAriaLabel = "Update settings",
  SubmitIcon = Upload,
  submitLabel = "Update",
  unsavedMessage = "Unsaved configuration changes.",
  ...props
}: ComponentPropsWithoutRef<"footer"> & {
  backingResourceChanged: boolean;
  canSubmit: boolean;
  cancelAriaLabel?: string;
  dirty: boolean;
  onCancel: () => void;
  onKeepEditing: () => void;
  onReload: () => void;
  onSubmit: () => void | Promise<void>;
  pending: boolean;
  pendingSubmitLabel?: string;
  saveFailureMessage: string | null;
  submitAriaLabel?: string;
  SubmitIcon?: LucideIcon | null;
  submitLabel?: string;
  unsavedMessage?: string;
}) {
  return (
    <footer
      className={cn("flex shrink-0 flex-col gap-2", className)}
      {...props}
    >
      {backingResourceChanged ? (
        <div
          className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-2 text-xs text-yellow-500 leading-4"
          role="status"
        >
          <span className="min-w-0 truncate">Backing resource changed.</span>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className="h-7 px-2 text-xs"
              onClick={onReload}
              type="button"
              variant="ghost"
            >
              Reload
            </Button>
            <Button
              className="h-7 px-2 text-xs"
              onClick={onKeepEditing}
              type="button"
              variant="ghost"
            >
              Keep editing
            </Button>
          </div>
        </div>
      ) : null}
      {saveFailureMessage == null ? null : (
        <p className="text-destructive text-xs leading-4" role="alert">
          {saveFailureMessage}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p
          className={cn(
            "min-w-0 truncate text-xs text-yellow-500 leading-4",
            !dirty && "invisible"
          )}
        >
          {unsavedMessage}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            aria-label={cancelAriaLabel}
            className="h-9 rounded-lg px-4 text-muted-foreground hover:bg-input hover:text-foreground"
            disabled={!dirty || pending}
            onClick={onCancel}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            aria-label={submitAriaLabel}
            className="h-9 rounded-lg bg-white/5 px-4 text-primary hover:bg-input"
            disabled={!canSubmit}
            onClick={async () => {
              await onSubmit();
            }}
            type="button"
            variant="ghost"
          >
            {SubmitIcon == null ? null : (
              <SubmitIcon aria-hidden className="size-4" />
            )}
            {pending ? pendingSubmitLabel : submitLabel}
          </Button>
        </div>
      </div>
    </footer>
  );
}

export function ResourceSettingsSlider({
  ariaLabel,
  disabled,
  formatBound,
  formatValue,
  icon,
  label,
  max,
  maxDecimals,
  min,
  onValueChange,
  step,
  value,
}: {
  ariaLabel: string;
  disabled?: boolean;
  formatBound?: (value: number) => ReactNode;
  formatValue: (value: number) => ReactNode;
  icon?: LucideIcon;
  label: string;
  max: number;
  maxDecimals: number;
  min: number;
  onValueChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  const Icon = icon;
  const boundFormatter = formatBound ?? String;

  return (
    <ResourceSettingsInset>
      <ScaleSlider.Root
        disabled={disabled}
        max={max}
        maxDecimals={maxDecimals}
        min={min}
        onValueChange={onValueChange}
        step={step}
        value={value}
        valueDisplay="number"
      >
        <ScaleSlider.Stack className="w-full gap-1.5">
          <ScaleSlider.Header className="mb-0.5 h-9">
            <ScaleSlider.Group className="min-w-0 gap-1.5">
              {Icon == null ? null : (
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
              )}
              <ScaleSlider.Label className="truncate text-muted-foreground text-sm leading-5">
                {label}
              </ScaleSlider.Label>
            </ScaleSlider.Group>
            <span className="shrink-0 text-foreground text-sm leading-5">
              {formatValue(value)}
            </span>
          </ScaleSlider.Header>
          <ScaleSlider.Control aria-label={ariaLabel} className="h-2">
            <ScaleSlider.Track className="h-2 bg-input">
              <ScaleSlider.Range className="bg-gradient-to-r from-blue-950 to-blue-500" />
            </ScaleSlider.Track>
            <ScaleSlider.Thumb className="size-4 border-2 border-primary bg-blue-500 shadow-none ring-0" />
          </ScaleSlider.Control>
          <div className="flex min-w-0 items-center justify-between gap-3 text-muted-foreground text-sm leading-5">
            <span className="truncate">{boundFormatter(min)}</span>
            <span className="truncate text-right">{boundFormatter(max)}</span>
          </div>
        </ScaleSlider.Stack>
      </ScaleSlider.Root>
    </ResourceSettingsInset>
  );
}
