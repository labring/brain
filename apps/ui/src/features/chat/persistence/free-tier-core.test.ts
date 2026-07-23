import assert from "node:assert/strict";
import { test } from "node:test";

import { freeTierPosture, freeTierPostureAfterTurn } from "./free-tier-core";

test("posture is free while turns remain and a platform model is configured", () => {
  assert.deepEqual(freeTierPosture({ limit: 5, remaining: 3 }, true), {
    billing: "free",
    limit: 5,
    remaining: 3,
  });
});

test("posture is user when no platform model is configured, even with a full allowance", () => {
  assert.deepEqual(freeTierPosture({ limit: 5, remaining: 5 }, false), {
    billing: "user",
    limit: 5,
    remaining: 5,
  });
});

test("posture is user once the allowance is exhausted", () => {
  assert.deepEqual(freeTierPosture({ limit: 5, remaining: 0 }, true), {
    billing: "user",
    limit: 5,
    remaining: 0,
  });
});

test("a mid-allowance free turn reports free with one fewer turn", () => {
  assert.deepEqual(freeTierPostureAfterTurn({ limit: 5, remaining: 3 }, true), {
    billing: "free",
    limit: 5,
    remaining: 2,
  });
});

// Regression: the turn that spends the LAST free turn must already report
// `user`, so the pane hides the Free counter and fires the crossing toast at
// exhaustion — not "Free 0/5" until the next message (or forever, if the next
// user-billed request fails and never delivers fresh headers).
test("the turn that spends the last free turn reports user, not Free 0/n", () => {
  assert.deepEqual(freeTierPostureAfterTurn({ limit: 5, remaining: 1 }, true), {
    billing: "user",
    limit: 5,
    remaining: 0,
  });
});

test("a user-billed turn leaves the snapshot untouched", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 5 }, false),
    { billing: "user", limit: 5, remaining: 5 }
  );
});
