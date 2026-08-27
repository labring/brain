import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";

/**
 * Relative time for a Notification row, from a real timestamp (epoch ms):
 * "Just now", "26m ago", "3h ago", "Yesterday", "5d ago", then a short date.
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
    return "Just now";
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  }
  if (elapsed < 2 * DAY_MS) {
    return "Yesterday";
  }
  if (elapsed < 7 * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)}d ago`;
  }
  return new Date(timestamp).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
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
