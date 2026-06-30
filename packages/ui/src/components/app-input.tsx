import { Input, type InputProps } from "@workspace/ui/components/input";
import { appFieldFocusClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import { forwardRef } from "react";

type AppInputProps = InputProps;

const AppInput = forwardRef<HTMLInputElement, AppInputProps>(function AppInput(
  { className, ...props },
  ref
) {
  return (
    <Input
      className={cn(
        "h-9 border-input bg-transparent text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
        appFieldFocusClass,
        className
      )}
      data-slot="app-input"
      ref={ref}
      {...props}
    />
  );
});

export type { AppInputProps };
export { AppInput };
