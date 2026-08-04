"use client";

import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { useDelayedFlag } from "@workspace/ui/hooks/use-delayed-flag";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

const appIconButtonVariants = cva(
  "rounded-lg border border-transparent shadow-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover data-popup-open:bg-brand-primary-hover",
        secondary:
          "bg-input/30 text-brand-primary-foreground hover:bg-input hover:text-blue-400 aria-[current=page]:bg-input aria-[current=page]:text-blue-400 data-[active=true]:bg-input data-popup-open:bg-input data-[active=true]:text-blue-400 data-popup-open:text-blue-400",
        quiet:
          "bg-transparent text-brand-primary-foreground hover:bg-input/30 hover:text-blue-400 aria-[current=page]:bg-input aria-[current=page]:text-blue-400 data-[active=true]:bg-input data-popup-open:bg-input/30 data-[active=true]:text-blue-400 data-popup-open:text-blue-400",
        node: "bg-zinc-950/20 text-brand-primary-foreground hover:bg-input hover:text-blue-400 data-popup-open:bg-input data-popup-open:text-blue-400",
        danger:
          "bg-input/30 text-foreground hover:bg-input hover:text-red-500 focus-visible:border-destructive/40 focus-visible:ring-destructive/25 data-popup-open:bg-input data-popup-open:text-red-500",
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

const busySpinnerSizeClasses = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-4",
} as const;

type AppIconButtonProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label" | "children" | "size" | "variant"
> &
  VariantProps<typeof appIconButtonVariants> & {
    "aria-label": string;
    /**
     * Marks the button's action as in flight. Busy feedback belongs on the
     * control when the action's outcome lands at the control itself (reveal,
     * on-demand copy) rather than in a toast. While busy the button ignores
     * further clicks but is never disabled — focus and screen-reader context
     * stay put — and the icon yields to a spinner only after
     * BUSY_INDICATOR_DELAY_MS so fast actions never flicker.
     */
    busy?: boolean;
    "data-slot"?: string;
    children: React.ReactNode;
  };

function AppIconButton({
  busy = false,
  children,
  className,
  "data-slot": dataSlot = "app-icon-button",
  onClick,
  size = "md",
  variant = "quiet",
  ...props
}: AppIconButtonProps) {
  const showBusyIndicator = useDelayedFlag(busy);

  return (
    <Button
      {...props}
      aria-busy={busy || undefined}
      className={cn(appIconButtonVariants({ variant, size }), className)}
      data-busy={busy || undefined}
      data-size={size}
      data-slot={dataSlot}
      data-variant={variant}
      onClick={busy ? undefined : onClick}
      size={null}
      variant={null}
    >
      {showBusyIndicator ? (
        <Spinner className={busySpinnerSizeClasses[size ?? "md"]} />
      ) : (
        children
      )}
    </Button>
  );
}

export type { AppIconButtonProps };
export { AppIconButton, appIconButtonVariants };
