import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScopedMutator } from "swr";

import {
  refreshFrontendSwrCachesOutputSchema,
  refreshFrontendSwrCachesTool,
  runRefreshFrontendSwrCachesTool,
} from "./chat-refresh-frontend-swr-tool";

test("refresh frontend SWR exposes a bounded strict scheduled output contract", () => {
  assert.deepEqual(
    refreshFrontendSwrCachesOutputSchema.parse({
      ok: true,
      status: "scheduled",
    }),
    { ok: true, status: "scheduled" }
  );
  assert.equal(
    refreshFrontendSwrCachesOutputSchema.safeParse({
      mutatedEntries: 1,
      ok: true,
      status: "scheduled",
    }).success,
    false
  );
  assert.deepEqual(
    refreshFrontendSwrCachesOutputSchema.parse({
      mutatedEntries: 3,
      ok: true,
    }),
    { ok: true, status: "scheduled" }
  );
  assert.equal(
    refreshFrontendSwrCachesOutputSchema.safeParse({
      error: "x".repeat(501),
      ok: false,
    }).success,
    false
  );
  assert.equal(
    Reflect.get(refreshFrontendSwrCachesTool, "outputSchema"),
    refreshFrontendSwrCachesOutputSchema
  );
});

test("refresh frontend SWR returns scheduled without waiting for revalidation", () => {
  const calls: unknown[][] = [];
  const mutate = ((...args: unknown[]) => {
    calls.push(args);
    return new Promise<unknown[]>(() => undefined);
  }) as unknown as ScopedMutator;

  const result = runRefreshFrontendSwrCachesTool(mutate, {
    intention: "refresh resources changed by the assistant",
  });

  assert.deepEqual(result, { ok: true, status: "scheduled" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.length, 1);
  assert.equal(typeof calls[0]?.[0], "function");
});

test("refresh frontend SWR logs a late revalidation rejection", async () => {
  let rejectRevalidation: (reason: unknown) => void = () => undefined;
  const pending = new Promise<unknown[]>((_, reject) => {
    rejectRevalidation = reject;
  });
  const mutate = (() => pending) as unknown as ScopedMutator;
  const originalConsoleError = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };

  try {
    const result = runRefreshFrontendSwrCachesTool(mutate, {
      intention: "refresh resources changed by the assistant",
    });
    rejectRevalidation(new Error("late refresh failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(result, { ok: true, status: "scheduled" });
    assert.deepEqual(errors, [
      [
        "[refreshFrontendSwrCaches] revalidation failed:",
        "late refresh failure",
      ],
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});
