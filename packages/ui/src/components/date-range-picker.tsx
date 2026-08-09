"use client";

import { Calendar } from "@workspace/ui/components/calendar";
import {
  RangePicker,
  RangePickerApply,
  RangePickerCancel,
  RangePickerContent,
  RangePickerFooter,
  RangePickerMain,
  RangePickerPresetItem,
  RangePickerPresets,
  RangePickerTrigger,
} from "@workspace/ui/components/range-picker";
import { cn } from "@workspace/ui/lib/utils";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

interface CompleteDateRange {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  className?: string;
  onChange?: (range: CompleteDateRange) => void;
  placeholder?: string;
  value?: CompleteDateRange;
}

function startOfDay(date: Date): Date {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

function daysBack(count: number): CompleteDateRange {
  const now = new Date();
  const from = startOfDay(now);
  from.setDate(from.getDate() - (count - 1));
  return { from, to: endOfDay(now) };
}

const PRESETS: {
  key: string;
  label: string;
  range: () => CompleteDateRange;
}[] = [
  { key: "last-7-days", label: "Last 7 days", range: () => daysBack(7) },
  { key: "last-30-days", label: "Last 30 days", range: () => daysBack(30) },
  { key: "last-90-days", label: "Last 90 days", range: () => daysBack(90) },
  {
    key: "this-month",
    label: "This month",
    range: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: endOfDay(now),
      };
    },
  },
  {
    key: "last-month",
    label: "Last month",
    range: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
  {
    // Month-to-date plus the two previous full calendar months, distinct
    // from the rolling last-90-days window.
    key: "last-3-months",
    label: "Last 3 months",
    range: () => {
      const now = new Date();
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 2, 1),
        to: endOfDay(now),
      };
    },
  },
];

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

// A stored range may carry local day boundaries (this picker's onChange) or
// UTC-snapped ones (calendarBillingDateRange), so accept either day reading.
function matchesDay(date: Date, target: Date): boolean {
  const key = localDayKey(target);
  return localDayKey(date) === key || date.toISOString().slice(0, 10) === key;
}

function activePresetFor(value: CompleteDateRange | undefined) {
  if (value == null) {
    return null;
  }
  return (
    PRESETS.find((preset) => {
      const range = preset.range();
      return (
        matchesDay(value.from, range.from) && matchesDay(value.to, range.to)
      );
    }) ?? null
  );
}

function formatDay(date: Date, withYear: boolean): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });
}

function formatRangeLabel(range: CompleteDateRange): string {
  const currentYear = new Date().getFullYear();
  const withYear =
    range.from.getFullYear() !== currentYear ||
    range.to.getFullYear() !== currentYear;
  return `${formatDay(range.from, withYear)} – ${formatDay(range.to, withYear)}`;
}

// First month of the two-month spread: the month before the range end, so
// the end month is always the right-hand one.
function monthAnchor(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function DateRangePicker({
  className,
  onChange,
  placeholder,
  value,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(value);
  const [month, setMonth] = useState(() =>
    monthAnchor(value?.to ?? new Date())
  );

  const activePreset = activePresetFor(value);
  const draftComplete = draft?.from != null && draft?.to != null;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(value);
      setMonth(monthAnchor(value?.to ?? new Date()));
    }
  };

  const applyDraft = () => {
    if (!(draft?.from && draft.to)) {
      return;
    }
    onChange?.({ from: startOfDay(draft.from), to: endOfDay(draft.to) });
    setOpen(false);
  };

  // Presets apply in one step but keep the popover open with the calendar
  // synced, so the chosen bounds stay visible.
  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    const range = preset.range();
    setDraft(range);
    setMonth(monthAnchor(range.to));
    onChange?.(range);
  };

  const label =
    activePreset?.label ??
    (value == null
      ? (placeholder ?? "Pick a date range")
      : formatRangeLabel(value));

  return (
    <RangePicker onOpenChange={handleOpenChange} open={open}>
      <RangePickerTrigger
        className={cn(value == null && "text-muted-foreground", className)}
        data-slot="date-range-picker"
      >
        <CalendarIcon
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{label}</span>
      </RangePickerTrigger>
      <RangePickerContent>
        <RangePickerMain>
          <Calendar
            className="p-0 [--cell-radius:var(--radius-lg)] [--cell-size:--spacing(9)]"
            disabled={{ after: new Date() }}
            mode="range"
            month={month}
            numberOfMonths={2}
            onMonthChange={setMonth}
            onSelect={setDraft}
            selected={draft}
            showOutsideDays={false}
          />
          <RangePickerFooter>
            <RangePickerCancel onClick={() => setOpen(false)}>
              Cancel
            </RangePickerCancel>
            <RangePickerApply disabled={!draftComplete} onClick={applyDraft}>
              Apply
            </RangePickerApply>
          </RangePickerFooter>
        </RangePickerMain>
        <RangePickerPresets>
          {PRESETS.map((preset) => (
            <RangePickerPresetItem
              key={preset.key}
              onClick={() => applyPreset(preset)}
              selected={activePreset?.key === preset.key}
            >
              {preset.label}
            </RangePickerPresetItem>
          ))}
        </RangePickerPresets>
      </RangePickerContent>
    </RangePicker>
  );
}

export type { CompleteDateRange, DateRangePickerProps };
export { DateRangePicker };
