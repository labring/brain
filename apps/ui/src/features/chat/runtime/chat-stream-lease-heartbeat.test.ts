import assert from "node:assert/strict";
import { test } from "node:test";

import { startChatStreamLeaseHeartbeat } from "./chat-stream-lease-heartbeat";

test("heartbeat renews repeatedly from the latest lease snapshot", async () => {
  const scheduled: Array<() => void> = [];
  const seenVersions: number[] = [];
  const heartbeat = startChatStreamLeaseHeartbeat({
    abort: () => {
      throw new Error("heartbeat unexpectedly aborted");
    },
    initialLease: { version: 0 },
    renew: (lease) => {
      seenVersions.push(lease.version);
      return Promise.resolve({ version: lease.version + 1 });
    },
    schedule: (run) => {
      scheduled.push(run);
      return () => undefined;
    },
  });

  scheduled.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
  scheduled.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(seenVersions, [0, 1]);
  assert.deepEqual(await heartbeat.stop(), { version: 2 });
});

test("heartbeat aborts the stream when renewal loses the lease", async () => {
  const scheduled: Array<() => void> = [];
  let abortReason: Error | undefined;
  const heartbeat = startChatStreamLeaseHeartbeat({
    abort: (reason) => {
      abortReason = reason;
    },
    initialLease: { version: 0 },
    renew: () => Promise.resolve(null),
    schedule: (run) => {
      scheduled.push(run);
      return () => undefined;
    },
  });

  scheduled.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(abortReason?.message, "Chat stream lease was lost");
  assert.equal(await heartbeat.stop(), null);
});

test("heartbeat aborts the stream when renewal throws synchronously", async () => {
  const scheduled: Array<() => void> = [];
  let abortReason: Error | undefined;
  const heartbeat = startChatStreamLeaseHeartbeat({
    abort: (reason) => {
      abortReason = reason;
    },
    initialLease: { version: 0 },
    renew: () => {
      throw new Error("database unavailable");
    },
    schedule: (run) => {
      scheduled.push(run);
      return () => undefined;
    },
  });

  scheduled.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(abortReason?.message, "database unavailable");
  assert.equal(await heartbeat.stop(), null);
});

test("stop waits for an in-flight renewal and returns its latest snapshot", async () => {
  const scheduled: Array<() => void> = [];
  let finishRenewal: ((lease: { version: number }) => void) | undefined;
  const heartbeat = startChatStreamLeaseHeartbeat({
    abort: () => {
      throw new Error("heartbeat unexpectedly aborted");
    },
    initialLease: { version: 0 },
    renew: () =>
      new Promise<{ version: number }>((resolve) => {
        finishRenewal = resolve;
      }),
    schedule: (run) => {
      scheduled.push(run);
      return () => undefined;
    },
  });
  scheduled.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  let stopped = false;
  const stop = heartbeat.stop().then((lease) => {
    stopped = true;
    return lease;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(stopped, false);

  finishRenewal?.({ version: 1 });
  assert.deepEqual(await stop, { version: 1 });
});
