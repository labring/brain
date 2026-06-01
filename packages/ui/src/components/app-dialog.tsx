"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
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
        "dark gap-0 overflow-hidden rounded-lg border border-white/10 bg-[#18191f]/95 p-0 text-foreground shadow-2xl backdrop-blur-[20px]",
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
        "flex min-w-0 items-center gap-2 border-white/10 border-b px-4 py-4",
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
        "inline-flex size-4 shrink-0 items-center justify-center text-yellow-400 [&_svg]:size-4",
        className
      )}
      data-slot="app-dialog-icon"
      {...props}
    >
      {children}
    </span>
  );
}

function AppDialogWarningIcon(props: ComponentProps<typeof AppDialogIcon>) {
  return (
    <AppDialogIcon {...props}>
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
        "min-w-0 flex-1 truncate font-medium text-lg/7 text-zinc-50",
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
      className={cn("flex flex-col gap-4 px-4 pt-4 text-sm/5", className)}
      data-slot="app-dialog-body"
      {...props}
    />
  );
}

function AppDialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2 px-4 pt-3 pb-4",
        className
      )}
      data-slot="app-dialog-footer"
      {...props}
    />
  );
}

const actionToneClass: Record<AppDialogActionTone, string> = {
  default: "bg-white/[0.045] text-zinc-100 hover:bg-white/10",
  destructive: "bg-red-500 text-white hover:bg-red-500/90",
};

function appDialogButtonClass(className?: string) {
  return cn(
    "inline-flex h-9 shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 font-medium text-sm/5 outline-none transition-colors",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    className
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
        <button
          className={appDialogButtonClass(
            cn(actionToneClass.default, className)
          )}
          type={type}
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
    <button
      className={appDialogButtonClass(cn(actionToneClass[tone], className))}
      data-loading={loading ? "true" : undefined}
      data-tone={tone}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
      {loading ? (loadingLabel ?? children) : children}
    </button>
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
      className={cn("font-medium text-sm/5 text-zinc-200", className)}
      {...props}
    />
  );
}

function AppDialogInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn(
        "h-8 border-white/15 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:border-white/25 focus-visible:ring-white/10 dark:bg-transparent",
        className
      )}
      {...props}
    />
  );
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
