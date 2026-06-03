import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const appIconButtonVariants = cva(
  "rounded-lg border border-transparent shadow-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover aria-expanded:bg-brand-primary-hover data-[state=open]:bg-brand-primary-hover",
        secondary:
          "bg-input/30 text-brand-primary-foreground hover:bg-input aria-expanded:bg-input data-[state=open]:bg-input",
        quiet:
          "bg-transparent text-brand-primary-foreground hover:bg-input/30 aria-expanded:bg-input/30 aria-[current=page]:bg-input/30 data-[active=true]:bg-input/30 data-[state=open]:bg-input/30",
        danger:
          "bg-input/30 text-foreground hover:bg-input hover:text-red-500 focus-visible:border-destructive/40 focus-visible:ring-destructive/25 aria-expanded:bg-input aria-expanded:text-red-500 data-[state=open]:bg-input data-[state=open]:text-red-500",
      },
      size: {
        sm: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        md: "size-8 [&_svg:not([class*='size-'])]:size-4",
        lg: "size-9 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "quiet",
      size: "md",
    },
  }
);

type AppIconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label" | "children" | "size" | "variant"
> &
  VariantProps<typeof appIconButtonVariants> & {
    "aria-label": string;
    "data-slot"?: string;
    children: React.ReactNode;
  };

function AppIconButton({
  className,
  "data-slot": dataSlot = "app-icon-button",
  size = "md",
  variant = "quiet",
  ...props
}: AppIconButtonProps) {
  return (
    <Button
      {...props}
      className={cn(appIconButtonVariants({ variant, size }), className)}
      data-size={size}
      data-slot={dataSlot}
      data-variant={variant}
      size={null}
      variant={null}
    />
  );
}

export type { AppIconButtonProps };
export { AppIconButton, appIconButtonVariants };
