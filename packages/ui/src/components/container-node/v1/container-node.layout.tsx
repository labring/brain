"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

export function ContainerNodeShell({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground text-xs shadow-xs",
        className
      )}
      {...props}
    />
  );
}

export function ContainerNodeHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-row flex-wrap items-center gap-2 border-border/60 border-b px-3 py-2",
        className
      )}
      {...props}
    />
  );
}

/** Icon + title stack row (left side of the header). Compose `IconPlaceholder`, `HeaderTitles`, and title primitives with their own props. */
export function ContainerNodeHeaderMain({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 items-center gap-2",
        className
      )}
      {...props}
    />
  );
}

/** Title + kind column beside the header icon. */
export function ContainerNodeHeaderTitles({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
      {...props}
    />
  );
}

export function ContainerNodeContent({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col px-3 py-2", className)}
      {...props}
    />
  );
}

export function ContainerNodeFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 flex-row items-center justify-between gap-3 border-border/60 border-t px-3 py-2",
        className
      )}
      {...props}
    />
  );
}

/** Cluster CPU / memory (or other) resource rows and pin them to the end of the footer (opposite status). */
export function ContainerNodeResourceGroup({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 items-center justify-end gap-3 whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}
