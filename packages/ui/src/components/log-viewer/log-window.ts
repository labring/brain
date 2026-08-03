import { format, isSameDay } from "date-fns";
import type { DateRange } from "react-day-picker";

/**
 * A log window is anchored either to "now" (live: relative span, follows new
 * output) or to fixed wall-clock bounds (frozen: never moves on its own).
 * There is no independent realtime flag: pairing one with a range permits
 * incoherent states by construction — polling a fixed historical range that
 * can never yield new lines, or a relative label describing a stale snapshot.
 */
export type LogWindow =
  | { mode: "live"; spanMs: number }
  | { mode: "frozen"; start: Date; end: Date };

export interface LogWindowBounds {
  end: Date;
  start: Date;
}

export const LIVE_SPANS = [
  { label: "Last 5 minutes", ms: 5 * 60_000, short: "5m" },
  { label: "Last 15 minutes", ms: 15 * 60_000, short: "15m" },
  { label: "Last 30 minutes", ms: 30 * 60_000, short: "30m" },
  { label: "Last 1 hour", ms: 60 * 60_000, short: "1h" },
  { label: "Last 3 hours", ms: 3 * 60 * 60_000, short: "3h" },
  { label: "Last 6 hours", ms: 6 * 60 * 60_000, short: "6h" },
  { label: "Last 24 hours", ms: 24 * 60 * 60_000, short: "24h" },
  { label: "Last 2 days", ms: 2 * 24 * 60 * 60_000, short: "2d" },
  { label: "Last 3 days", ms: 3 * 24 * 60 * 60_000, short: "3d" },
  { label: "Last 7 days", ms: 7 * 24 * 60 * 60_000, short: "7d" },
] as const;

export const DEFAULT_LIVE_SPAN_MS = 60 * 60_000;

export function logWindowBounds(
  logWindow: LogWindow,
  now = new Date()
): LogWindowBounds {
  if (logWindow.mode === "frozen") {
    return { end: logWindow.end, start: logWindow.start };
  }
  return {
    end: now,
    start: new Date(now.getTime() - logWindow.spanMs),
  };
}

/** Materialize a live window into fixed bounds; frozen windows pass through. */
export function freezeLogWindow(
  logWindow: LogWindow,
  now = new Date()
): LogWindow {
  if (logWindow.mode === "frozen") {
    return logWindow;
  }
  const { start, end } = logWindowBounds(logWindow, now);
  return { end, mode: "frozen", start };
}

export function liveSpanShortLabel(spanMs: number): string {
  const preset = LIVE_SPANS.find((span) => span.ms === spanMs);
  if (preset) {
    return preset.short;
  }
  const minutes = Math.round(spanMs / 60_000);
  if (minutes >= 60 && minutes % 60 === 0) {
    return `${minutes / 60}h`;
  }
  return `${minutes}m`;
}

/**
 * Frozen windows always read as their actual bounds, never as a relative
 * label: "Jul 2 · 11:15 – 12:15" same-day, "Jul 1 23:00 – Jul 2 01:00"
 * cross-day, with years added when a bound leaves the current year.
 */
export function formatFrozenWindowLabel(
  start: Date,
  end: Date,
  now = new Date()
): string {
  const withYear =
    start.getFullYear() !== now.getFullYear() ||
    end.getFullYear() !== now.getFullYear();
  const dayPattern = withYear ? "MMM d yyyy" : "MMM d";
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) {
    return `${format(start, dayPattern)} · ${format(start, "HH:mm")} – ${format(end, "HH:mm")}`;
  }
  return `${format(start, `${dayPattern} HH:mm`)} – ${format(end, `${dayPattern} HH:mm`)}`;
}

export function formatLogWindowLabel(
  logWindow: LogWindow,
  now = new Date()
): string {
  if (logWindow.mode === "live") {
    const preset = LIVE_SPANS.find((span) => span.ms === logWindow.spanMs);
    return preset?.label ?? `Last ${liveSpanShortLabel(logWindow.spanMs)}`;
  }
  return formatFrozenWindowLabel(logWindow.start, logWindow.end, now);
}

/**
 * Range-calendar click semantics for the log picker. When a complete
 * multi-day range exists, react-day-picker's default treats a click on
 * either endpoint as "restart the range at the clicked day"; users read
 * that click as "deselect this endpoint". Collapse to the other endpoint
 * instead, and keep the library's proposed range for every other click.
 */
export function resolveRangeClick(
  prev: DateRange | undefined,
  clicked: Date,
  proposed: DateRange | undefined
): DateRange | undefined {
  if (!(prev?.from && prev.to) || isSameDay(prev.from, prev.to)) {
    return proposed;
  }
  if (isSameDay(clicked, prev.to)) {
    return { from: prev.from, to: prev.from };
  }
  if (isSameDay(clicked, prev.from)) {
    return { from: prev.to, to: prev.to };
  }
  return proposed;
}
