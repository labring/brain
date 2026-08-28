import assert from "node:assert/strict";
import { test } from "node:test";

import { formatNotificationTime } from "./notification-time";

const NOW = Date.UTC(2026, 7, 27, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SHORT_DATE_RE = /^[A-Z][a-z]{2} \d{1,2}$/;

test("relative time steps from just now through days", () => {
  assert.equal(formatNotificationTime(NOW - 10_000, NOW), "now");
  assert.equal(formatNotificationTime(NOW - 2 * MINUTE, NOW), "2m");
  assert.equal(formatNotificationTime(NOW - 26 * MINUTE, NOW), "26m");
  assert.equal(formatNotificationTime(NOW - HOUR, NOW), "1h");
  assert.equal(formatNotificationTime(NOW - 23 * HOUR, NOW), "23h");
  assert.equal(formatNotificationTime(NOW - 30 * HOUR, NOW), "1d");
  assert.equal(formatNotificationTime(NOW - 2 * DAY, NOW), "2d");
  assert.equal(formatNotificationTime(NOW - 6 * DAY, NOW), "6d");
});

test("older than a week falls back to a short date; the future reads as now", () => {
  assert.match(formatNotificationTime(NOW - 30 * DAY, NOW), SHORT_DATE_RE);
  assert.equal(formatNotificationTime(NOW + HOUR, NOW), "now");
  assert.equal(formatNotificationTime(Number.NaN, NOW), "");
});
