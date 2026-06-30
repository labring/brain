"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";

export interface SlidingToggleOption<TValue extends string = string> {
  ariaLabel?: string;
  disabled?: boolean;
  label: ReactNode;
  value: TValue;
}

export type SlidingToggleSize = "default" | "sm";
export type SlidingToggleWidth = "auto" | "full";

export interface SlidingToggleProps<TValue extends string = string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  indicatorClassName?: string;
  itemClassName?: string;
  onValueChange: (value: TValue) => void;
  options: readonly SlidingToggleOption<TValue>[];
  size?: SlidingToggleSize;
  value: TValue;
  width?: SlidingToggleWidth;
}

const slidingToggleSizeClasses = {
  default: {
    indicator: "rounded-lg",
    item: "!rounded-lg h-9 px-2 text-sm",
    root: "h-9 rounded-lg",
  },
  sm: {
    indicator: "rounded-md",
    item: "!rounded-md h-8 px-3 text-xs",
    root: "h-8 rounded-md",
  },
} satisfies Record<
  SlidingToggleSize,
  { indicator: string; item: string; root: string }
>;

const slidingToggleWidthClasses = {
  auto: "w-auto",
  full: "w-full",
} satisfies Record<SlidingToggleWidth, string>;

export function SlidingToggle<TValue extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  indicatorClassName,
  itemClassName,
  onValueChange,
  options,
  size = "default",
  value,
  width = "full",
}: SlidingToggleProps<TValue>) {
  if (options.length === 0) {
    return null;
  }

  const sizeClasses = slidingToggleSizeClasses[size];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const indicatorStyle = {
    transform: `translateX(${selectedIndex * 100}%)`,
    width: `${100 / options.length}%`,
  } satisfies CSSProperties;
  const groupStyle = {
    gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
  } satisfies CSSProperties;

  return (
    <ToggleGroup
      aria-label={ariaLabel}
      className={cn(
        "relative grid overflow-hidden bg-muted/40 p-0 text-foreground",
        sizeClasses.root,
        slidingToggleWidthClasses[width],
        className
      )}
      onValueChange={(nextValue) => {
        const next = nextValue[0];
        const nextOption = options.find((option) => option.value === next);
        if (nextOption != null) {
          onValueChange(nextOption.value);
        }
      }}
      spacing={0}
      style={groupStyle}
      value={[value]}
      variant="outline"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-0 bg-input transition-transform duration-200 ease-out",
          sizeClasses.indicator,
          indicatorClassName
        )}
        data-slot="sliding-toggle-indicator"
        style={indicatorStyle}
      />
      {options.map((option) => (
        <ToggleGroupItem
          aria-label={option.ariaLabel}
          className={cn(
            "relative z-10 min-w-0 border-0 bg-transparent hover:bg-transparent aria-pressed:bg-transparent data-[state=on]:bg-transparent",
            sizeClasses.item,
            itemClassName
          )}
          disabled={disabled || option.disabled}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
