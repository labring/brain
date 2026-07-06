"use client";

import "@ncdai/react-wheel-picker/style.css";

import {
  WheelPicker,
  type WheelPickerOption,
  WheelPickerWrapper,
} from "@ncdai/react-wheel-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { Clock } from "lucide-react";
import { useMemo } from "react";

function buildOptions(count: number): WheelPickerOption<number>[] {
  return Array.from({ length: count }, (_, index) => ({
    label: index.toString().padStart(2, "0"),
    value: index,
  }));
}

const HOUR_OPTIONS = buildOptions(24);
const MINUTE_OPTIONS = buildOptions(60);
const SECOND_OPTIONS = buildOptions(60);

function clampPart(value: number, max: number) {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), max);
}

function parseTime(value: string): [number, number, number] {
  const [rawHours, rawMinutes, rawSeconds] = value.split(":");
  return [
    clampPart(Number.parseInt(rawHours ?? "0", 10), 23),
    clampPart(Number.parseInt(rawMinutes ?? "0", 10), 59),
    clampPart(Number.parseInt(rawSeconds ?? "0", 10), 59),
  ];
}

function formatTime(hours: number, minutes: number, seconds: number) {
  return [hours, minutes, seconds]
    .map((part) => part.toString().padStart(2, "0"))
    .join(":");
}

const SHARED_WHEEL_CLASS_NAMES = {
  highlightItem: "font-normal text-foreground text-sm",
  optionItem: "font-normal text-foreground text-sm",
};

interface TimeWheelFieldProps {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  value: string;
}

/**
 * Read-only time field that reveals an iOS-style hour/minute/second wheel
 * picker beneath itself. The wheel lives in a portalled popover so its frosted
 * `backdrop-blur` is not suppressed by the parent popover's own backdrop
 * filter. `open` is controlled by the parent so only one field (Start or End)
 * can be expanded at a time.
 */
export function TimeWheelField({
  className,
  label,
  onChange,
  onOpenChange,
  open,
  value,
}: TimeWheelFieldProps) {
  const [hours, minutes, seconds] = useMemo(() => parseTime(value), [value]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="text-foreground text-sm">{label}</span>
      <Popover onOpenChange={onOpenChange} open={open}>
        <PopoverTrigger
          render={
            <button
              className={cn(
                "flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-transparent py-1 pr-3 pl-4 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/30",
                open && "border-blue-400 ring-[1px] ring-blue-400/50"
              )}
              type="button"
            />
          }
        >
          <span className="tabular-nums">
            {formatTime(hours, minutes, seconds)}
          </span>
          <Clock className="size-4 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[150px] overflow-hidden rounded-lg border border-border bg-input/30 p-1 ring-0 backdrop-blur-xl"
          sideOffset={4}
        >
          <div className="time-wheel-picker">
            <WheelPickerWrapper>
              <WheelPicker
                classNames={{
                  ...SHARED_WHEEL_CLASS_NAMES,
                  highlightWrapper: "rounded-l-md bg-blue-500",
                }}
                infinite
                onValueChange={(next) =>
                  onChange(formatTime(next, minutes, seconds))
                }
                optionItemHeight={36}
                options={HOUR_OPTIONS}
                value={hours}
                visibleCount={12}
              />
              <WheelPicker
                classNames={{
                  ...SHARED_WHEEL_CLASS_NAMES,
                  highlightWrapper: "bg-blue-500",
                }}
                infinite
                onValueChange={(next) =>
                  onChange(formatTime(hours, next, seconds))
                }
                optionItemHeight={36}
                options={MINUTE_OPTIONS}
                value={minutes}
                visibleCount={12}
              />
              <WheelPicker
                classNames={{
                  ...SHARED_WHEEL_CLASS_NAMES,
                  highlightWrapper: "rounded-r-md bg-blue-500",
                }}
                infinite
                onValueChange={(next) =>
                  onChange(formatTime(hours, minutes, next))
                }
                optionItemHeight={36}
                options={SECOND_OPTIONS}
                value={seconds}
                visibleCount={12}
              />
            </WheelPickerWrapper>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
