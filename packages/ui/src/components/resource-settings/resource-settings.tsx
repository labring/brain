"use client";

import { AppButton } from "@workspace/ui/components/app-button";
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
  cancelAriaLabel = "Discard settings changes",
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
  unsavedMessage = "Unsaved changes",
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
            <AppButton
              className="h-7 px-2 text-xs"
              onClick={onReload}
              type="button"
              variant="quiet"
            >
              Reload
            </AppButton>
            <AppButton
              className="h-7 px-2 text-xs"
              onClick={onKeepEditing}
              type="button"
              variant="quiet"
            >
              Keep editing
            </AppButton>
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
            "flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-4",
            !dirty && "invisible"
          )}
          role="status"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70"
          />
          <span className="min-w-0 truncate">{unsavedMessage}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <AppButton
            aria-label={cancelAriaLabel}
            className="h-9 rounded-lg px-4 text-muted-foreground hover:bg-input hover:text-foreground"
            disabled={!dirty || pending}
            onClick={onCancel}
            type="button"
            variant="quiet"
          >
            Discard
          </AppButton>
          <AppButton
            aria-label={submitAriaLabel}
            className="h-9 rounded-lg bg-white/5 px-4 text-primary hover:bg-input"
            disabled={!canSubmit}
            onClick={async () => {
              await onSubmit();
            }}
            type="button"
            variant="quiet"
          >
            {SubmitIcon == null ? null : (
              <SubmitIcon aria-hidden className="size-4" />
            )}
            {pending ? pendingSubmitLabel : submitLabel}
          </AppButton>
        </div>
      </div>
    </footer>
  );
}
