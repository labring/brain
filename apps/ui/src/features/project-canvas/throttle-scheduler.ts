/**
 * A leading + trailing throttle that collapses a burst of `schedule()` calls
 * into at most one `run()` per `intervalMs`.
 *
 * `schedule()` runs `run` immediately when idle (leading edge) and, if called
 * again while the window is cooling down, runs it once more when the window
 * elapses (trailing edge) — so the final call in a burst is never dropped, and
 * a sustained storm settles to one run per interval.
 *
 * We use it to coalesce high-frequency SSE stream events into far fewer React
 * state commits: the caller buffers each event synchronously, and
 * `run` reads whatever has been buffered by the time it fires.
 */
export interface ThrottleScheduler {
  /** Drop any pending trailing run and close the window; call on teardown. */
  cancel(): void;
  /** Request a run: immediate when idle, else coalesced to the trailing edge. */
  schedule(): void;
}

/** Timer seam so the scheduler can be driven by a fake clock in tests. */
export interface ThrottleTimers {
  clearTimeout(handle: unknown): void;
  setTimeout(handler: () => void, ms: number): unknown;
}

const DEFAULT_TIMERS: ThrottleTimers = {
  clearTimeout: (handle) => {
    clearTimeout(handle as Parameters<typeof clearTimeout>[0]);
  },
  setTimeout: (handler, ms) => setTimeout(handler, ms),
};

export function createThrottleScheduler(
  intervalMs: number,
  run: () => void,
  timers: ThrottleTimers = DEFAULT_TIMERS
): ThrottleScheduler {
  let timer: unknown = null;
  let pending = false;

  const onTimeout = () => {
    if (!pending) {
      // The window went idle: close it so the next call is a leading edge.
      timer = null;
      return;
    }
    pending = false;
    run();
    timer = timers.setTimeout(onTimeout, intervalMs);
  };

  return {
    cancel() {
      if (timer !== null) {
        timers.clearTimeout(timer);
        timer = null;
      }
      pending = false;
    },
    schedule() {
      if (timer === null) {
        run();
        timer = timers.setTimeout(onTimeout, intervalMs);
        return;
      }
      pending = true;
    },
  };
}
