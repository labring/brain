// bun:test, not node:test: this file shares a `bun test` run with the
// react-harness suites, whose in-flight async tests make Bun's node:test
// shim reject a second file's registrations as nested test() calls.
import { test } from "bun:test";
import assert from "node:assert/strict";

import {
  answerOnboardingStep,
  completeOnboardingProfile,
  dismissOnboardingProfile,
  onboardingWriteQueueSettled,
} from "./client";

const credentials = {
  appToken: "token",
  kubeconfig: "kc",
  namespace: "ns-user",
};

const STEP_PATH_RE = /\/step/;
const COMPLETE_PATH_RE = /\/complete/;
const DISMISS_PATH_RE = /\/dismiss/;

function installFetchStub(handler: (path: string) => Promise<Response>): {
  calls: string[];
  restore: () => void;
} {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const path = String(input);
    calls.push(path);
    return handler(path);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("a terminal write cannot overtake an in-flight step write", async () => {
  let releaseStep: (() => void) | undefined;
  const stub = installFetchStub((path) => {
    if (path.includes("/step")) {
      return new Promise((resolve) => {
        releaseStep = () => resolve(new Response(null, { status: 200 }));
      });
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  try {
    answerOnboardingStep(credentials, {
      roleOtherText: null,
      roleType: "founder",
      step: 1,
    });
    completeOnboardingProfile(credentials, "ship an app");
    await flushMicrotasks();

    // The step write is on the wire; the terminal complete is still queued
    // behind it — the store's terminal-wins can never see them reordered.
    assert.equal(stub.calls.length, 1);
    assert.match(stub.calls[0] ?? "", STEP_PATH_RE);

    assert.ok(releaseStep, "the step fetch was issued");
    releaseStep?.();
    await onboardingWriteQueueSettled();

    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[1] ?? "", COMPLETE_PATH_RE);
  } finally {
    stub.restore();
  }
});

test("a failed write releases the queue for the writes behind it", async () => {
  const stub = installFetchStub((path) =>
    path.includes("/step")
      ? Promise.reject(new Error("network down"))
      : Promise.resolve(new Response(null, { status: 200 }))
  );
  try {
    answerOnboardingStep(credentials, {
      roleOtherText: null,
      roleType: "founder",
      step: 1,
    });
    dismissOnboardingProfile(credentials, 2);
    await onboardingWriteQueueSettled();

    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[1] ?? "", DISMISS_PATH_RE);
  } finally {
    stub.restore();
  }
});
