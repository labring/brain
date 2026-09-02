import assert from "node:assert/strict";
import { test } from "node:test";

import { freeTierPosture, freeTierPostureAfterTurn } from "./free-tier-core";

test("posture is free on an active trial while turns remain and a platform model is configured", () => {
  assert.deepEqual(freeTierPosture({ limit: 5, remaining: 3 }, true, "trial"), {
    billing: "free",
    limit: 5,
    remaining: 3,
  });
});

test("posture is user when no platform model is configured, even with a full allowance", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 5 }, false, "trial"),
    {
      billing: "user",
      limit: 5,
      remaining: 5,
    }
  );
});

test("posture hands an exhausted active trial off to user billing", () => {
  assert.deepEqual(freeTierPosture({ limit: 5, remaining: 0 }, true, "trial"), {
    billing: "user",
    limit: 5,
    remaining: 0,
  });
});

test("a non-trial workspace bills user from its first turn, full allowance included", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 5 }, true, "not-trial"),
    {
      billing: "user",
      limit: 5,
      remaining: 5,
    }
  );
});

test("a non-trial workspace stays user-billed at exhaustion", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 0 }, true, "not-trial"),
    {
      billing: "user",
      limit: 5,
      remaining: 0,
    }
  );
});

// Fail-open (ADR-0065): a failed judgment serves free while count remains…
test("an unknown judgment with turns remaining serves free", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 2 }, true, "unknown"),
    {
      billing: "free",
      limit: 5,
      remaining: 2,
    }
  );
});

// …and degrades to user when exhausted.
test("an unknown judgment with the allowance exhausted degrades to user", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 0 }, true, "unknown"),
    {
      billing: "user",
      limit: 5,
      remaining: 0,
    }
  );
});

// FREE_CHAT_TURNS=0 disables the feature entirely: silent user billing.
test("a zero limit keeps silent user billing even on a confirmed trial", () => {
  assert.deepEqual(freeTierPosture({ limit: 0, remaining: 0 }, true, "trial"), {
    billing: "user",
    limit: 0,
    remaining: 0,
  });
});

test("a missing platform model keeps silent user at exhaustion", () => {
  assert.deepEqual(
    freeTierPosture({ limit: 5, remaining: 0 }, false, "trial"),
    {
      billing: "user",
      limit: 5,
      remaining: 0,
    }
  );
});

test("a mid-allowance free turn reports free with one fewer turn", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 3 }, true, "trial"),
    {
      billing: "free",
      limit: 5,
      remaining: 2,
    }
  );
});

// The turn that spends the LAST free turn already reports `user`, so the next
// request is ready to use the caller's AI Proxy.
test("the turn that spends the last free turn reports user billing", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 1 }, true, "trial"),
    {
      billing: "user",
      limit: 5,
      remaining: 0,
    }
  );
});

test("the last free turn under an unknown judgment degrades to user", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 1 }, true, "unknown"),
    {
      billing: "user",
      limit: 5,
      remaining: 0,
    }
  );
});

test("a user-billed turn leaves the snapshot untouched", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 5 }, true, "not-trial"),
    { billing: "user", limit: 5, remaining: 5 }
  );
});

test("an exhausted user-billed turn never decrements below zero", () => {
  assert.deepEqual(
    freeTierPostureAfterTurn({ limit: 5, remaining: 0 }, true, "trial"),
    { billing: "user", limit: 5, remaining: 0 }
  );
});
