"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps } from "react";

export function ProjectCreatorShell({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("dark flex min-w-0 flex-col gap-4", className)}
      data-slot="project-creator-shell"
      {...props}
    />
  );
}
