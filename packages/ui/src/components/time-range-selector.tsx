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

export type TimeRange =
  | { mode: "quick"; ms: number }
  | { mode: "custom"; start: Date; end: Date };

export const QUICK_RANGES = [
  { label: "Last 5 min", short: "Last 5m", ms: 5 * 60_000 },
  { label: "Last 15 min", short: "Last 15m", ms: 15 * 60_000 },
  { label: "Last 30 min", short: "Last 30m", ms: 30 * 60_000 },
  { label: "Last 1 hour", short: "Last 1h", ms: 60 * 60_000 },
  { label: "Last 3 hours", short: "Last 3h", ms: 3 * 60 * 60_000 },
  { label: "Last 6 hours", short: "Last 6h", ms: 6 * 60 * 60_000 },
];

interface TimeRangeSelectorProps {
  className?: string;
  onChange: (range: TimeRange) => void;
  value: TimeRange;
}

export function TimeRangeSelector({
  value,
  onChange,
  className,
}: TimeRangeSelectorProps) {
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
    if (value.mode === "custom") {
      setDraftRange({ from: value.start, to: value.end });
      setDraftStartTime(format(value.start, "HH:mm:ss"));
      setDraftEndTime(format(value.end, "HH:mm:ss"));
    } else {
      const now = new Date();
      const from = new Date(now.getTime() - value.ms);
      setDraftRange({ from, to: now });
      setDraftStartTime(format(from, "HH:mm:ss"));
      setDraftEndTime(format(now, "HH:mm:ss"));
    }
  }, [open, value]);

  function handleConfirm() {
    if (!(draftRange?.from && draftRange?.to)) {
      return;
    }
    const startParts = draftStartTime.split(":").map(Number);
    const endParts = draftEndTime.split(":").map(Number);
    const start = new Date(draftRange.from);
    start.setHours(
      startParts[0] ?? 0,
      startParts[1] ?? 0,
      startParts[2] ?? 0,
      0
    );
    const end = new Date(draftRange.to);
    end.setHours(endParts[0] ?? 23, endParts[1] ?? 59, endParts[2] ?? 59, 999);
    onChange({ mode: "custom", start, end });
    setOpen(false);
  }

  function handleQuickRange(ms: number) {
    onChange({ mode: "quick", ms });
    setOpen(false);
  }

  const triggerLabel =
    value.mode === "quick"
      ? (QUICK_RANGES.find((r) => r.ms === value.ms)?.label ?? "Custom")
      : "Custom";

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          "flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/30 focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50 aria-expanded:border-blue-400 aria-expanded:ring-[1px] aria-expanded:ring-blue-400/50 aria-expanded:ring-offset-0 dark:bg-transparent",
          className
        )}
      >
        <Clock className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{triggerLabel}</span>
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
                disabled={!(draftRange?.from && draftRange?.to)}
                onClick={handleConfirm}
                size="sm"
              >
                Apply
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1 p-3">
            <span className="mb-1 font-medium text-muted-foreground text-xs">
              Relative
            </span>
            {QUICK_RANGES.map((r) => (
              <button
                className={cn(
                  "rounded-md px-3 py-1.5 text-left text-foreground text-sm hover:bg-input/30",
                  value.mode === "quick" &&
                    value.ms === r.ms &&
                    "bg-input font-medium"
                )}
                key={r.ms}
                onClick={() => handleQuickRange(r.ms)}
                type="button"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
