"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { Loader2, TriangleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type AppDialogSize = "sm" | "default" | "lg" | "xl";
type AppDialogActionTone = "default" | "destructive";

function AppDialogRoot(props: ComponentProps<typeof Dialog>) {
  return <Dialog {...props} />;
}

function AppDialogTrigger(props: ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger {...props} />;
}

function AppDialogContent({
  className,
  overlayClassName,
  size = "default",
  ...props
}: Omit<ComponentProps<typeof DialogContent>, "showCloseButton"> & {
  size?: AppDialogSize;
}) {
  return (
    <DialogContent
      className={cn(
        "dark flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden rounded-lg border border-border bg-project-chrome-surface p-0 text-foreground shadow-2xl ring-0 backdrop-blur-[20px]",
        "max-w-[calc(100vw-2rem)] data-[size=default]:sm:max-w-[502px] data-[size=lg]:sm:max-w-3xl data-[size=sm]:sm:max-w-sm data-[size=xl]:sm:max-w-5xl",
        className
      )}
      data-size={size}
      overlayClassName={cn("bg-black/40 backdrop-blur-xs", overlayClassName)}
      showCloseButton={false}
      {...props}
    />
  );
}

function AppDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "grid min-w-0 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-border border-b py-4 pr-5 pl-4",
        "[&>[data-slot=dialog-description]]:col-span-2 [&>[data-slot=dialog-description]]:min-w-0",
        "[&>[data-slot=dialog-title]:first-child]:col-span-2",
        className
      )}
      data-slot="app-dialog-header"
      {...props}
    />
  );
}

function AppDialogIcon({
  className,
  children,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center text-zinc-50 [&_svg]:size-4",
        className
      )}
      data-slot="app-dialog-icon"
      {...props}
    >
      {children}
    </span>
  );
}

function AppDialogWarningIcon({
  className,
  ...props
}: ComponentProps<typeof AppDialogIcon>) {
  return (
    <AppDialogIcon className={cn("text-yellow-400", className)} {...props}>
      <TriangleAlert aria-hidden />
    </AppDialogIcon>
  );
}

function AppDialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogTitle>) {
  return (
    <DialogTitle
      className={cn(
        "h-5 min-w-0 flex-1 truncate font-medium text-lg/5 text-zinc-50",
        className
      )}
      {...props}
    />
  );
}

function AppDialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogDescription>) {
  return (
    <DialogDescription
      className={cn("text-sm/5 text-zinc-400", className)}
      {...props}
    />
  );
}

function AppDialogBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pt-4 text-sm/5",
        className
      )}
      data-slot="app-dialog-body"
      {...props}
    />
  );
}

function AppDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 pt-4 pb-4",
        className
      )}
      data-slot="app-dialog-footer"
      {...props}
    />
  );
}

function AppDialogCancel({
  className,
  children = "Cancel",
  type = "button",
  ...props
}: ComponentProps<"button">) {
  return (
    <DialogClose
      render={
        <AppButton
          className={className}
          type={type}
          variant="secondary"
          {...props}
        />
      }
    >
      {children}
    </DialogClose>
  );
}

function AppDialogAction({
  className,
  children,
  disabled,
  loading = false,
  loadingLabel,
  tone = "default",
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  loading?: boolean;
  loadingLabel?: ReactNode;
  tone?: AppDialogActionTone;
}) {
  const isDisabled = disabled || loading;

  return (
    <AppButton
      className={className}
      data-loading={loading ? "true" : undefined}
      data-tone={tone}
      disabled={isDisabled}
      type={type}
      variant={tone === "destructive" ? "danger" : "secondary"}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
      {loading ? (loadingLabel ?? children) : children}
    </AppButton>
  );
}

function AppDialogDestructiveAction(
  props: Omit<ComponentProps<typeof AppDialogAction>, "tone">
) {
  return <AppDialogAction tone="destructive" {...props} />;
}

function AppDialogField({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      data-slot="app-dialog-field"
      {...props}
    />
  );
}

function AppDialogLabel({ className, ...props }: ComponentProps<typeof Label>) {
  return (
    <Label
      className={cn(
        "font-medium text-sm text-zinc-200 leading-none",
        className
      )}
      {...props}
    />
  );
}

function AppDialogInput({
  className,
  ...props
}: ComponentProps<typeof AppInput>) {
  return <AppInput className={className} {...props} />;
}

export const AppDialog = {
  Action: AppDialogAction,
  Body: AppDialogBody,
  Cancel: AppDialogCancel,
  Content: AppDialogContent,
  Description: AppDialogDescription,
  DestructiveAction: AppDialogDestructiveAction,
  Field: AppDialogField,
  Footer: AppDialogFooter,
  Header: AppDialogHeader,
  Icon: AppDialogIcon,
  Input: AppDialogInput,
  Label: AppDialogLabel,
  Root: AppDialogRoot,
  Title: AppDialogTitle,
  Trigger: AppDialogTrigger,
  WarningIcon: AppDialogWarningIcon,
} as const;

const dn = (component: object, name: string) => {
  (component as { displayName?: string }).displayName = name;
};

dn(AppDialogRoot, "AppDialog.Root");
dn(AppDialogTrigger, "AppDialog.Trigger");
dn(AppDialogContent, "AppDialog.Content");
dn(AppDialogHeader, "AppDialog.Header");
dn(AppDialogIcon, "AppDialog.Icon");
dn(AppDialogWarningIcon, "AppDialog.WarningIcon");
dn(AppDialogTitle, "AppDialog.Title");
dn(AppDialogDescription, "AppDialog.Description");
dn(AppDialogBody, "AppDialog.Body");
dn(AppDialogFooter, "AppDialog.Footer");
dn(AppDialogCancel, "AppDialog.Cancel");
dn(AppDialogAction, "AppDialog.Action");
dn(AppDialogDestructiveAction, "AppDialog.DestructiveAction");
dn(AppDialogField, "AppDialog.Field");
dn(AppDialogLabel, "AppDialog.Label");
dn(AppDialogInput, "AppDialog.Input");
