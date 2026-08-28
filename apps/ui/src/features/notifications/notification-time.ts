import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";

/**
 * The short relative time on a Notification row, from a real timestamp
 * (epoch ms): "now", "26m", "3h", "5d", then a short date. The row pairs it
 * with `formatNotificationTimestamp` as a tooltip for the exact moment.
 */
export function formatNotificationTime(
  timestamp: number,
  now: number = Date.now()
): string {
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < MINUTE_MS) {
    return "now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h`;
  }
  if (elapsed < 7 * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d`;
  }
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });
}

/** The absolute moment behind a row's short time ("Aug 21, 2026, 3:05 PM"). */
export function formatNotificationTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Date(timestamp).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * An absolute date for Notification bodies (design spec §10 rule 5, "Sep 3"
 * style); an unparsable instant renders as an empty string so a sentence
 * never carries "Invalid Date".
 */
export function formatNotificationDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}
