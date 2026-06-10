import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import type * as React from "react";

type AppTextareaProps = React.ComponentProps<typeof Textarea>;

function AppTextarea({ className, ...props }: AppTextareaProps) {
  return (
    <Textarea
      className={cn(
        "field-sizing-content placeholder-shown:field-sizing-fixed min-h-9 border-input bg-transparent px-2.5 py-1.5 text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
        "focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50",
        className
      )}
      data-slot="app-textarea"
      {...props}
    />
  );
}

export type { AppTextareaProps };
export { AppTextarea };
