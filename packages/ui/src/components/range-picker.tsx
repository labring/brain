"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown } from "lucide-react";
import type * as React from "react";

// The shared look of range pickers (log window, billing dates): a compact
// trigger with a rotating chevron, a frosted two-column popover — picker
// content on the left, presets on the right — and the Cancel/Apply pair.
// Consumers keep their own range model and apply semantics and compose
// these parts.

const RangePicker = Popover;

function RangePickerTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PopoverTrigger>) {
  return (
    <PopoverTrigger
      className={cn(
        "group flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-input/30 px-3 py-2 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/50 focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50 aria-expanded:border-blue-400 aria-expanded:ring-[1px] aria-expanded:ring-blue-400/50 aria-expanded:ring-offset-0",
        className
      )}
      data-slot="range-picker-trigger"
      {...props}
    >
      {children}
      <ChevronDown className="size-3.5 shrink-0 opacity-50 transition-transform duration-150 ease-out group-aria-expanded:rotate-180 motion-reduce:transition-none" />
    </PopoverTrigger>
  );
}

function RangePickerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  return (
    <PopoverContent
      align="start"
      className={cn(
        "w-auto border border-border bg-input/30 p-0 text-foreground shadow-md ring-0 backdrop-blur-xl",
        className
      )}
      {...props}
    >
      {/* The slot marker lives on the inner wrapper: overriding the popover's
          own data-slot would break calendar.tsx's popover-content selector. */}
      <div className="flex" data-slot="range-picker-content">
        {children}
      </div>
    </PopoverContent>
  );
}

function RangePickerMain({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-border border-r p-4",
        className
      )}
      data-slot="range-picker-main"
      {...props}
    />
  );
}

function RangePickerPresets({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 p-4", className)}
      data-slot="range-picker-presets"
      {...props}
    />
  );
}

function RangePickerPresetItem({
  className,
  selected = false,
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      className={cn(
        "flex h-9 cursor-pointer items-center rounded-md px-2 text-left text-foreground text-sm hover:bg-input/30",
        selected && "bg-input",
        className
      )}
      data-slot="range-picker-preset-item"
      type="button"
      {...props}
    />
  );
}

function RangePickerFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex justify-end gap-2", className)}
      data-slot="range-picker-footer"
      {...props}
    />
  );
}

function RangePickerCancel({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-9 rounded-lg bg-input/30 px-4 text-foreground text-sm hover:bg-input/50",
        className
      )}
      variant="secondary"
      {...props}
    />
  );
}

function RangePickerApply({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      className={cn(
        "h-9 rounded-lg bg-blue-500 px-4 text-foreground text-sm hover:bg-blue-500/90",
        className
      )}
      {...props}
    />
  );
}

export {
  RangePicker,
  RangePickerApply,
  RangePickerCancel,
  RangePickerContent,
  RangePickerFooter,
  RangePickerMain,
  RangePickerPresetItem,
  RangePickerPresets,
  RangePickerTrigger,
};
