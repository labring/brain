/**
 * The workbench's clock: reading now, and scheduling work for later.
 *
 * Deployment Task Dock completion notices expire on a timer, which is the only
 * orchestration behavior that cannot be driven from an event. Production runs
 * on real timers; tests advance a manual clock, so notice expiry is a scenario
 * at the workbench interface rather than a sleeping test.
 */
export interface WorkbenchClock {
  now: () => number;
  /** Runs `callback` after `delayMs`; the returned function cancels it. */
  schedule: (callback: () => void, delayMs: number) => () => void;
}

export const realWorkbenchClock: WorkbenchClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

export interface ManualWorkbenchClock extends WorkbenchClock {
  /** Moves time forward, firing everything that comes due. */
  advance: (ms: number) => void;
}

export function createManualWorkbenchClock(startMs = 0): ManualWorkbenchClock {
  let nowMs = startMs;
  let nextId = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();

  return {
    advance: (ms: number) => {
      const target = nowMs + ms;
      // Fire in due order, so a callback that schedules more work still sees a
      // monotonic clock rather than jumping straight to the target.
      while (true) {
        let dueId: number | undefined;
        let dueAt = Number.POSITIVE_INFINITY;
        for (const [id, entry] of pending) {
          if (entry.at <= target && entry.at < dueAt) {
            dueId = id;
            dueAt = entry.at;
          }
        }
        if (dueId === undefined) {
          break;
        }
        const entry = pending.get(dueId);
        pending.delete(dueId);
        nowMs = Math.max(nowMs, dueAt);
        entry?.callback();
      }
      nowMs = target;
    },
    now: () => nowMs,
    schedule: (callback, delayMs) => {
      const id = nextId++;
      pending.set(id, { at: nowMs + delayMs, callback });
      return () => {
        pending.delete(id);
      };
    },
  };
}
