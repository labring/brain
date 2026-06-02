import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const appButtonVariants = cva(
  "gap-2 rounded-lg border border-transparent font-medium text-sm leading-5 shadow-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary",
        quiet:
          "bg-input/35 text-foreground hover:bg-input/65 aria-expanded:bg-input/65 dark:bg-white/5 dark:hover:bg-input",
        danger:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/25",
        link: "bg-transparent text-primary hover:bg-transparent hover:text-primary hover:underline",
      },
      size: {
        sm: "h-7 gap-1.5 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        default:
          "h-9 px-4 py-2 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        lg: "h-10 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

type AppButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "size" | "variant"
> &
  VariantProps<typeof appButtonVariants>;

function AppButton({
  className,
  variant = "primary",
  size = "default",
  ...props
}: AppButtonProps) {
  return (
    <Button
      {...props}
      className={cn(appButtonVariants({ variant, size }), className)}
      data-size={size}
      data-slot="app-button"
      data-variant={variant}
      size={null}
      variant={null}
    />
  );
}

export type { AppButtonProps };
export { AppButton, appButtonVariants };
