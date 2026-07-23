const CHAT_STREAM_LEASE_HEARTBEAT_INTERVAL_MS = 60_000;

type ScheduleHeartbeat = (run: () => void, delayMs: number) => () => void;

function scheduleWithTimeout(run: () => void, delayMs: number): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

export interface ChatStreamLeaseHeartbeat<Lease> {
  stop: () => Promise<Lease | null>;
}

export function startChatStreamLeaseHeartbeat<Lease>(input: {
  abort: (reason: Error) => void;
  initialLease: Lease;
  intervalMs?: number;
  renew: (lease: Lease) => Promise<Lease | null>;
  schedule?: ScheduleHeartbeat;
}): ChatStreamLeaseHeartbeat<Lease> {
  const schedule = input.schedule ?? scheduleWithTimeout;
  const intervalMs =
    input.intervalMs ?? CHAT_STREAM_LEASE_HEARTBEAT_INTERVAL_MS;
  let currentLease: Lease | null = input.initialLease;
  let stopped = false;
  let cancelScheduled: () => void = () => undefined;
  let inFlight: Promise<void> | null = null;

  const scheduleNext = () => {
    cancelScheduled = schedule(run, intervalMs);
  };

  const fail = (reason: unknown) => {
    currentLease = null;
    stopped = true;
    input.abort(
      reason instanceof Error
        ? reason
        : new Error("Chat stream lease renewal failed")
    );
  };

  const run = () => {
    if (stopped || currentLease == null || inFlight != null) {
      return;
    }
    const lease = currentLease;
    inFlight = Promise.resolve()
      .then(() => input.renew(lease))
      .then((renewed) => {
        if (renewed == null) {
          fail(new Error("Chat stream lease was lost"));
          return;
        }
        currentLease = renewed;
      })
      .catch(fail)
      .finally(() => {
        inFlight = null;
        if (!stopped && currentLease != null) {
          scheduleNext();
        }
      });
  };

  scheduleNext();
  return {
    stop: async () => {
      stopped = true;
      cancelScheduled();
      await inFlight;
      return currentLease;
    },
  };
}
