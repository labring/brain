import { format } from "date-fns";

/**
 * A log window is anchored either to "now" (live: relative span, follows new
 * output) or to fixed wall-clock bounds (frozen: never moves on its own).
 * There is no independent realtime flag — see docs/adr/0034.
 */
export type LogWindow =
  | { mode: "live"; spanMs: number }
  | { mode: "frozen"; start: Date; end: Date };

export interface LogWindowBounds {
  end: Date;
  start: Date;
}

export const LIVE_SPANS = [
  { label: "Last 5 min", ms: 5 * 60_000, short: "5m" },
  { label: "Last 15 min", ms: 15 * 60_000, short: "15m" },
  { label: "Last 30 min", ms: 30 * 60_000, short: "30m" },
  { label: "Last 1 hour", ms: 60 * 60_000, short: "1h" },
  { label: "Last 3 hours", ms: 3 * 60 * 60_000, short: "3h" },
  { label: "Last 6 hours", ms: 6 * 60 * 60_000, short: "6h" },
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
    return `Live · ${liveSpanShortLabel(logWindow.spanMs)}`;
  }
  return formatFrozenWindowLabel(logWindow.start, logWindow.end, now);
}
