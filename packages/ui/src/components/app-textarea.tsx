import { Textarea } from "@workspace/ui/components/textarea";
import { appFieldFocusClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

type AppTextareaProps = React.ComponentProps<typeof Textarea>;

function AppTextarea({ className, ...props }: AppTextareaProps) {
  return (
    <Textarea
      className={cn(
        "field-sizing-content placeholder-shown:field-sizing-fixed min-h-9 border-input bg-transparent px-2.5 py-[7px] text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
        appFieldFocusClass,
        className
      )}
      data-slot="app-textarea"
      {...props}
    />
  );
}

export type { AppTextareaProps };
export { AppTextarea };
