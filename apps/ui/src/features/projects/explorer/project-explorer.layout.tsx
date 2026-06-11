"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

/** Outer chrome for the explorer (opinionated shadow + column flex). */
export function ProjectExplorerShell({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden text-sm shadow-xs",
        className
      )}
      {...props}
    />
  );
}

/** Region shell: padding only; compose {@link ProjectExplorerHeaderBrand}, toolbar leaves, etc. as `children`. */
export function ProjectExplorerHeader({
  className,
  children,
  ...props
}: ComponentProps<"div"> & { children?: ReactNode }) {
  return (
    <div className={cn("px-0 pt-0 pb-6", className)} {...props}>
      {children}
    </div>
  );
}
