import { appFieldInvalidClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "field-sizing-content flex min-h-16 w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-base shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground not-aria-invalid:focus-visible:border-ring not-aria-invalid:focus-visible:ring-[3px] not-aria-invalid:focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        appFieldInvalidClass,
        className
      )}
      data-slot="textarea"
      {...props}
    />
  );
}

export { Textarea };
