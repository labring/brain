import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatFrozenWindowLabel,
  formatLogWindowLabel,
  freezeLogWindow,
  liveSpanShortLabel,
  logWindowBounds,
  resolveRangeClick,
} from "./log-window";

test("live window bounds trail now by the span", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");

  assert.deepEqual(logWindowBounds({ mode: "live", spanMs: 60_000 }, now), {
    end: now,
    start: new Date("2026-07-02T11:59:00.000Z"),
  });
});

test("frozen window bounds pass through unchanged", () => {
  const start = new Date("2026-07-02T11:00:00.000Z");
  const end = new Date("2026-07-02T11:30:00.000Z");

  assert.deepEqual(logWindowBounds({ end, mode: "frozen", start }), {
    end,
    start,
  });
});

test("freezing a live window materializes bounds at that instant", () => {
  const now = new Date("2026-07-02T12:00:00.000Z");

  assert.deepEqual(freezeLogWindow({ mode: "live", spanMs: 5 * 60_000 }, now), {
    end: now,
    mode: "frozen",
    start: new Date("2026-07-02T11:55:00.000Z"),
  });
});

test("freezing a frozen window is a no-op", () => {
  const frozen = {
    end: new Date("2026-07-02T11:30:00.000Z"),
    mode: "frozen",
    start: new Date("2026-07-02T11:00:00.000Z"),
  } as const;

  assert.equal(freezeLogWindow(frozen), frozen);
});

test("live span short labels cover presets and fall back to minutes", () => {
  assert.equal(liveSpanShortLabel(60 * 60_000), "1h");
  assert.equal(liveSpanShortLabel(5 * 60_000), "5m");
  assert.equal(liveSpanShortLabel(24 * 60 * 60_000), "24h");
  assert.equal(liveSpanShortLabel(90_000), "2m");
});

test("frozen labels always state actual bounds", () => {
  const now = new Date(2026, 6, 2, 13, 0, 0);

  assert.equal(
    formatFrozenWindowLabel(
      new Date(2026, 6, 2, 11, 15, 19),
      new Date(2026, 6, 2, 12, 15, 19),
      now
    ),
    "Jul 2 · 11:15 – 12:15"
  );
  assert.equal(
    formatFrozenWindowLabel(
      new Date(2026, 6, 1, 23, 0, 0),
      new Date(2026, 6, 2, 1, 0, 0),
      now
    ),
    "Jul 1 23:00 – Jul 2 01:00"
  );
  assert.equal(
    formatFrozenWindowLabel(
      new Date(2025, 11, 31, 23, 0, 0),
      new Date(2026, 0, 1, 1, 0, 0),
      now
    ),
    "Dec 31 2025 23:00 – Jan 1 2026 01:00"
  );
});

test("window labels read live as span and frozen as bounds", () => {
  assert.equal(
    formatLogWindowLabel({ mode: "live", spanMs: 60 * 60_000 }),
    "Last 1 hour"
  );
  assert.equal(
    formatLogWindowLabel({ mode: "live", spanMs: 2 * 24 * 60 * 60_000 }),
    "Last 2 days"
  );
  assert.equal(
    formatLogWindowLabel({ mode: "live", spanMs: 90 * 60_000 }),
    "Last 90m"
  );
  const now = new Date(2026, 6, 2, 13, 0, 0);
  assert.equal(
    formatLogWindowLabel(
      {
        end: new Date(2026, 6, 2, 12, 15, 0),
        mode: "frozen",
        start: new Date(2026, 6, 2, 11, 15, 0),
      },
      now
    ),
    "Jul 2 · 11:15 – 12:15"
  );
});

test("clicking a range endpoint deselects that endpoint", () => {
  // Seeded ranges carry times-of-day; clicks arrive at midnight.
  const from = new Date(2026, 6, 3, 17, 0, 23);
  const to = new Date(2026, 6, 5, 18, 0, 23);
  const range = { from, to };

  assert.deepEqual(resolveRangeClick(range, new Date(2026, 6, 5), undefined), {
    from,
    to: from,
  });
  assert.deepEqual(resolveRangeClick(range, new Date(2026, 6, 3), undefined), {
    from: to,
    to,
  });
});

test("non-endpoint clicks keep the proposed range", () => {
  const range = { from: new Date(2026, 6, 3), to: new Date(2026, 6, 5) };
  const extended = { from: range.from, to: new Date(2026, 6, 9) };

  // Clicking outside/inside the range defers to react-day-picker's proposal.
  assert.equal(
    resolveRangeClick(range, new Date(2026, 6, 9), extended),
    extended
  );

  // A single-day selection re-clicked deselects entirely (proposal passes through).
  const single = { from: new Date(2026, 6, 3), to: new Date(2026, 6, 3) };
  assert.equal(
    resolveRangeClick(single, new Date(2026, 6, 3), undefined),
    undefined
  );

  // No prior selection: first click starts the proposed single-day range.
  const started = { from: new Date(2026, 6, 3), to: new Date(2026, 6, 3) };
  assert.equal(
    resolveRangeClick(undefined, new Date(2026, 6, 3), started),
    started
  );
});
