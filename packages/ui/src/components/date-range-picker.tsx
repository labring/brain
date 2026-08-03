"use client";

import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
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

function formatCalendarDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
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

function DateRangePicker({
  className,
  onChange,
  placeholder,
  value,
}: DateRangePickerProps) {
  const [draft, setDraft] = useState<DateRange | undefined>(value);

  const selectRange = (range: DateRange | undefined) => {
    setDraft(range);
    if (range?.from != null && range.to != null) {
      onChange?.({ from: startOfDay(range.from), to: endOfDay(range.to) });
    }
  };

  const shown = draft ?? value;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          setDraft(value);
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            className={cn(
              "justify-start text-left font-normal",
              shown == null && "text-muted-foreground",
              className
            )}
            data-slot="date-range-picker"
            type="button"
            variant="outline"
          />
        }
      >
        <CalendarIcon aria-hidden />
        {shown?.from == null ? (
          <span>{placeholder ?? "Pick a date range"}</span>
        ) : (
          <span className="tabular-nums">
            {formatCalendarDay(shown.from)}
            {shown.to == null ? "" : ` - ${formatCalendarDay(shown.to)}`}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          defaultMonth={shown?.from}
          mode="range"
          numberOfMonths={2}
          onSelect={selectRange}
          selected={draft}
          showOutsideDays={false}
        />
      </PopoverContent>
    </Popover>
  );
}

export type { CompleteDateRange, DateRangePickerProps };
export { DateRangePicker };
