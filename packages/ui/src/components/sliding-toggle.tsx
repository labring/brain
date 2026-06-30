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

export interface SlidingToggleProps<TValue extends string = string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  indicatorClassName?: string;
  itemClassName?: string;
  onValueChange: (value: TValue) => void;
  options: readonly SlidingToggleOption<TValue>[];
  value: TValue;
}

export function SlidingToggle<TValue extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  indicatorClassName,
  itemClassName,
  onValueChange,
  options,
  value,
}: SlidingToggleProps<TValue>) {
  if (options.length === 0) {
    return null;
  }

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
        "relative grid h-9 w-full overflow-hidden rounded-lg bg-muted/40 p-0 text-foreground",
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
          "pointer-events-none absolute inset-y-0 left-0 z-0 rounded-lg bg-input transition-transform duration-200 ease-out",
          indicatorClassName
        )}
        data-slot="sliding-toggle-indicator"
        style={indicatorStyle}
      />
      {options.map((option) => (
        <ToggleGroupItem
          aria-label={option.ariaLabel}
          className={cn(
            "!rounded-lg relative z-10 h-9 min-w-0 border-0 bg-transparent text-sm hover:bg-transparent aria-pressed:bg-transparent data-[state=on]:bg-transparent",
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
