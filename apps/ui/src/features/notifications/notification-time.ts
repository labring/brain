const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
