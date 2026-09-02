"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { cn } from "@workspace/ui/lib/utils";
import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

type AppOptionShape = "checkbox" | "radio";

/**
 * The selection glyph pairs shape with the option's semantics: single-select
 * options show a ring radio (blue inner dot, unfilled), multi-select options
 * a filled square check — the conventional pairing, and the one the shared
 * checkbox already uses. The blue border on the unselected glyph is the
 * survey design's accent.
 */
function AppSelectionIndicator({
  className,
  selected,
  shape,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  selected: boolean;
  shape: AppOptionShape;
}) {
  let glyph: ReactNode = null;
  if (selected) {
    glyph =
      shape === "radio" ? (
        <span className="size-2 rounded-full bg-blue-500" />
      ) : (
        <Check className="size-3" />
      );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border border-blue-500",
        shape === "radio" ? "rounded-full" : "rounded-xs",
        selected && shape === "checkbox" && "bg-blue-500 text-white",
        className
      )}
      data-slot="app-selection-indicator"
      {...props}
    >
      {glyph}
    </span>
  );
}

const OPTION_CARD_CLASS =
  // min-h, not h: a long label or a description grows and wraps rather than
  // truncating its one-liner.
  "flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent px-4 py-2 text-left text-foreground text-sm outline-none transition-colors focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50";

function optionCardClass(
  selected: boolean,
  disabled: boolean,
  className?: string
): string {
  return cn(
    OPTION_CARD_CLASS,
    // The deepened wash carries the selected state so it never rides on the
    // 16px glyph alone.
    selected ? "bg-input" : "bg-input/30 hover:border-border",
    disabled && "cursor-not-allowed opacity-50 hover:border-transparent",
    className
  );
}

interface AppOptionCardProps {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onToggle: () => void;
  selected: boolean;
  /**
   * What the card announces. `toggle` (the default) is a pressed button;
   * `checkbox` is a real checkbox — space toggles it and assistive tech
   * reads "checkbox, checked" — for a multi-select where the cards are the
   * checkboxes.
   */
  semantics?: "checkbox" | "toggle";
  shape: AppOptionShape;
}

/**
 * A selectable survey option: label on the left, selection glyph on the
 * right, the card's wash deepening when selected. Shared by the Onboarding
 * survey and the Cancellation Survey.
 */
function AppOptionCard({
  children,
  className,
  disabled = false,
  onToggle,
  selected,
  semantics = "toggle",
  shape,
}: AppOptionCardProps) {
  const body = (
    <>
      <span className="min-w-0">{children}</span>
      <AppSelectionIndicator selected={selected} shape={shape} />
    </>
  );
  if (semantics === "checkbox") {
    return (
      <CheckboxPrimitive.Root
        checked={selected}
        className={optionCardClass(selected, disabled, className)}
        data-slot="app-option-card"
        disabled={disabled}
        onCheckedChange={onToggle}
      >
        {body}
      </CheckboxPrimitive.Root>
    );
  }
  return (
    <button
      aria-pressed={selected}
      className={optionCardClass(selected, disabled, className)}
      data-slot="app-option-card"
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      {body}
    </button>
  );
}

/** The length allowance at a free-text field's tail: current/max, muted. */
function AppLengthHint({
  className,
  max,
  value,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  max: number;
  value: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 text-muted-foreground text-xs tabular-nums",
        className
      )}
      data-slot="app-length-hint"
      {...props}
    >
      {value.length}/{max}
    </span>
  );
}

export type { AppOptionShape };
export { AppLengthHint, AppOptionCard, AppSelectionIndicator };
