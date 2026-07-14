import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createThrottleScheduler,
  type ThrottleTimers,
} from "./throttle-scheduler";

/** A controllable clock: only fires timers when `advance` walks past their due time. */
function fakeClock() {
  let now = 0;
  let nextHandle = 0;
  const scheduled = new Map<number, { at: number; fn: () => void }>();

  const timers: ThrottleTimers = {
    clearTimeout(handle) {
      scheduled.delete(handle as number);
    },
    setTimeout(fn, ms) {
      nextHandle += 1;
      scheduled.set(nextHandle, { at: now + ms, fn });
      return nextHandle;
    },
  };

  const takeDue = () => {
    let dueId: number | undefined;
    let dueAt = Number.POSITIVE_INFINITY;
    for (const [id, entry] of scheduled) {
      if (entry.at <= now && entry.at < dueAt) {
        dueAt = entry.at;
        dueId = id;
      }
    }
    if (dueId === undefined) {
      return;
    }
    const entry = scheduled.get(dueId);
    scheduled.delete(dueId);
    return entry;
  };

  const advance = (ms: number) => {
    now += ms;
    let entry = takeDue();
    while (entry !== undefined) {
      entry.fn();
      entry = takeDue();
    }
  };

  return { advance, timers };
}

test("throttle scheduler: runs immediately on the leading edge", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  scheduler.schedule();

  assert.equal(runs, 1);
});

test("throttle scheduler: collapses a burst into one trailing run", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.schedule();
  assert.equal(runs, 1);

  clock.advance(200);
  assert.equal(runs, 2);
});

test("throttle scheduler: a lone leading call has no trailing run", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  scheduler.schedule();
  clock.advance(1000);

  assert.equal(runs, 1);
});

test("throttle scheduler: caps a sustained storm to one run per interval", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  // An event every 100 ms for ~1 s: one leading run plus one per 200 ms window.
  for (let step = 0; step < 10; step += 1) {
    scheduler.schedule();
    clock.advance(100);
  }

  assert.equal(runs, 6);
});

test("throttle scheduler: re-opens the leading edge after going idle", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  scheduler.schedule();
  clock.advance(200);
  scheduler.schedule();

  assert.equal(runs, 2);
});

test("throttle scheduler: cancel drops a pending trailing run", () => {
  const clock = fakeClock();
  let runs = 0;
  const scheduler = createThrottleScheduler(
    200,
    () => {
      runs += 1;
    },
    clock.timers
  );

  scheduler.schedule();
  scheduler.schedule();
  scheduler.cancel();
  clock.advance(1000);

  assert.equal(runs, 1);
});
