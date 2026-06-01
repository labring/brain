"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

export function SettingsSliderGroup({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("inline-flex min-w-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}

export function SettingsSliderStack({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex w-full min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  );
}

export function SettingsSliderHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "mb-0.5 flex h-9 w-full min-w-0 items-center justify-between gap-2",
        className
      )}
      {...props}
    />
  );
}

export function SettingsSliderLabel({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      className={cn(
        "truncate text-muted-foreground text-sm leading-5",
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
