import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";

const inputVariants = cva(
  "h-9 w-full min-w-0 border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-[color,box-shadow] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-medium file:text-foreground file:text-sm placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
  {
    variants: {
      variant: {
        default:
          "rounded-md shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        bare: "rounded-none shadow-none focus-visible:border-input focus-visible:ring-0 aria-invalid:border-destructive aria-invalid:ring-0 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export type InputProps = InputPrimitive.Props &
  VariantProps<typeof inputVariants> & {
    className?: string;
  };

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, variant, ...props },
  ref
) {
  return (
    <InputPrimitive
      className={cn(inputVariants({ variant }), className)}
      data-slot="input"
      ref={ref}
      type={type}
      {...props}
    />
  );
});

export { Input, inputVariants };
