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
import { TimeWheelField } from "@workspace/ui/components/time-wheel-field";
import { format } from "date-fns";
import { CalendarClock } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  formatLogWindowLabel,
  LIVE_SPANS,
  type LogWindow,
  logWindowBounds,
  resolveRangeClick,
} from "./log-window";

interface LogWindowSelectorProps {
  className?: string;
  onChange: (logWindow: LogWindow) => void;
  value: LogWindow;
}

function draftBounds(
  range: DateRange | undefined,
  startTime: string,
  endTime: string
): { end: Date; start: Date } | null {
  if (!(range?.from && range?.to)) {
    return null;
  }
  const startParts = startTime.split(":").map(Number);
  const endParts = endTime.split(":").map(Number);
  const start = new Date(range.from);
  start.setHours(startParts[0] ?? 0, startParts[1] ?? 0, startParts[2] ?? 0, 0);
  const end = new Date(range.to);
  end.setHours(endParts[0] ?? 23, endParts[1] ?? 59, endParts[2] ?? 59, 999);
  if (start.getTime() >= end.getTime()) {
    return null;
  }
  return { end, start };
}

export function LogWindowSelector({
  value,
  onChange,
  className,
}: LogWindowSelectorProps) {
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<"start" | "end" | null>(null);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();
  const [draftStartTime, setDraftStartTime] = useState("00:00:00");
  const [draftEndTime, setDraftEndTime] = useState("23:59:59");

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      return;
    }
    setActiveField(null);
    // Seed the frozen-window editor from the materialized bounds of whatever
    // is currently displayed — the "narrow down what I'm seeing" starting point.
    const { start, end } = logWindowBounds(value);
    setDraftRange({ from: start, to: end });
    setDraftStartTime(format(start, "HH:mm:ss"));
    setDraftEndTime(format(end, "HH:mm:ss"));
  }

  const draft = draftBounds(draftRange, draftStartTime, draftEndTime);

  function handleApply() {
    if (!draft) {
      return;
    }
    onChange({ end: draft.end, mode: "frozen", start: draft.start });
    setOpen(false);
  }

  function handleLiveSpan(spanMs: number) {
    onChange({ mode: "live", spanMs });
    setOpen(false);
  }

  return (
    <RangePicker onOpenChange={handleOpenChange} open={open}>
      <RangePickerTrigger className={className}>
        {value.mode === "live" ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-blue-400"
          />
        ) : (
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{formatLogWindowLabel(value)}</span>
      </RangePickerTrigger>
      <RangePickerContent>
        <RangePickerMain>
          <Calendar
            className="w-79 p-0 [--cell-radius:var(--radius-lg)] [--cell-size:--spacing(9)]"
            mode="range"
            numberOfMonths={1}
            onSelect={(range, clicked) =>
              setDraftRange(resolveRangeClick(draftRange, clicked, range))
            }
            selected={draftRange}
          />
          <div className="flex gap-4">
            <TimeWheelField
              className="flex-1"
              label="Start"
              onChange={setDraftStartTime}
              onOpenChange={(next) => setActiveField(next ? "start" : null)}
              open={activeField === "start"}
              value={draftStartTime}
            />
            <TimeWheelField
              className="flex-1"
              label="End"
              onChange={setDraftEndTime}
              onOpenChange={(next) => setActiveField(next ? "end" : null)}
              open={activeField === "end"}
              value={draftEndTime}
            />
          </div>
          <RangePickerFooter>
            <RangePickerCancel onClick={() => setOpen(false)}>
              Cancel
            </RangePickerCancel>
            <RangePickerApply disabled={!draft} onClick={handleApply}>
              Apply
            </RangePickerApply>
          </RangePickerFooter>
        </RangePickerMain>
        <RangePickerPresets>
          {LIVE_SPANS.map((span) => (
            <RangePickerPresetItem
              key={span.ms}
              onClick={() => handleLiveSpan(span.ms)}
              selected={value.mode === "live" && value.spanMs === span.ms}
            >
              {span.label}
            </RangePickerPresetItem>
          ))}
        </RangePickerPresets>
      </RangePickerContent>
    </RangePicker>
  );
}
