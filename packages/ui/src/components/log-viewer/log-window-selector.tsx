"use client";

import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { TimeWheelField } from "@workspace/ui/components/time-wheel-field";
import { cn } from "@workspace/ui/lib/utils";
import { format } from "date-fns";
import { CalendarClock, ChevronDown } from "lucide-react";
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
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        className={cn(
          "flex h-9 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-input/30 px-3 py-2 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/50 focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50 aria-expanded:border-blue-400 aria-expanded:ring-[1px] aria-expanded:ring-blue-400/50 aria-expanded:ring-offset-0",
          className
        )}
      >
        {value.mode === "live" ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-blue-400"
          />
        ) : (
          <CalendarClock className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{formatLogWindowLabel(value)}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto border border-border bg-input/30 p-0 text-foreground shadow-md ring-0 backdrop-blur-xl"
      >
        <div className="flex">
          <div className="flex flex-col gap-4 border-border border-r p-4">
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
            <div className="flex justify-end gap-2">
              <Button
                className="h-9 rounded-lg bg-input/30 px-4 text-foreground text-sm hover:bg-input/50"
                onClick={() => setOpen(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                className="h-9 rounded-lg bg-blue-500 px-4 text-foreground text-sm hover:bg-blue-500/90"
                disabled={!draft}
                onClick={handleApply}
              >
                Apply
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1 p-4">
            {LIVE_SPANS.map((span) => (
              <button
                className={cn(
                  "flex h-9 items-center rounded-md px-2 text-left text-foreground text-sm hover:bg-input/30",
                  value.mode === "live" &&
                    value.spanMs === span.ms &&
                    "bg-input"
                )}
                key={span.ms}
                onClick={() => handleLiveSpan(span.ms)}
                type="button"
              >
                {span.label}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
