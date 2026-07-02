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
import { ChevronDown, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import {
  formatLogWindowLabel,
  LIVE_SPANS,
  type LogWindow,
  logWindowBounds,
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

  useEffect(() => {
    if (!open) {
      return;
    }
    setActiveField(null);
    // Seed the frozen-window editor from the materialized bounds of whatever
    // is currently displayed — the "narrow down what I'm seeing" starting point.
    const { start, end } = logWindowBounds(value);
    setDraftRange({ from: start, to: end });
    setDraftStartTime(format(start, "HH:mm:ss"));
    setDraftEndTime(format(end, "HH:mm:ss"));
  }, [open, value]);

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
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          "flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/30 focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50 aria-expanded:border-blue-400 aria-expanded:ring-[1px] aria-expanded:ring-blue-400/50 aria-expanded:ring-offset-0 dark:bg-transparent",
          className
        )}
      >
        {value.mode === "live" ? (
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-blue-400"
          />
        ) : (
          <Clock className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{formatLogWindowLabel(value)}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto border border-border bg-input/30 p-0 text-foreground shadow-md ring-0 backdrop-blur-xl"
      >
        <div className="flex">
          <div className="flex flex-col gap-3 border-border border-r p-3">
            <Calendar
              classNames={{
                button_next:
                  "border border-input bg-transparent text-muted-foreground opacity-50 hover:bg-input/30 hover:text-foreground",
                button_previous:
                  "border border-input bg-transparent text-muted-foreground opacity-50 hover:bg-input/30 hover:text-foreground",
                day_button:
                  "data-[range-end=true]:bg-blue-500 data-[range-middle=true]:bg-input data-[range-start=true]:bg-blue-500 data-[selected-single=true]:bg-blue-500 data-[range-end=true]:text-foreground data-[range-middle=true]:text-foreground data-[range-start=true]:text-foreground data-[selected-single=true]:text-foreground hover:bg-input/30 dark:hover:bg-input/30",
                outside:
                  "text-muted-foreground opacity-50 aria-selected:text-muted-foreground",
                range_end:
                  "relative isolate -z-0 rounded-r-(--cell-radius) bg-input after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-input",
                range_middle: "rounded-none bg-input",
                range_start:
                  "relative isolate -z-0 rounded-l-(--cell-radius) bg-input after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-input",
                today:
                  "rounded-(--cell-radius) bg-input/30 text-foreground data-[selected=true]:rounded-none",
                weekday:
                  "flex-1 select-none rounded-(--cell-radius) font-normal text-[0.8rem] text-muted-foreground",
              }}
              mode="range"
              numberOfMonths={1}
              onSelect={setDraftRange}
              selected={draftRange}
            />
            <div className="flex gap-4 px-1">
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
            <div className="flex justify-end gap-2 px-1">
              <Button
                onClick={() => setOpen(false)}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                className="bg-blue-500 text-foreground hover:bg-blue-500/90"
                disabled={!draft}
                onClick={handleApply}
                size="sm"
              >
                Apply
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1 p-3">
            <span className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground text-xs">
              <span aria-hidden className="size-1.5 rounded-full bg-blue-400" />
              Live
            </span>
            {LIVE_SPANS.map((span) => (
              <button
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-foreground text-sm hover:bg-input/30",
                  value.mode === "live" &&
                    value.spanMs === span.ms &&
                    "bg-input font-medium"
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
