import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aiUsageRowFromCredits,
  aiUsageRowFromFreeTurns,
} from "./app-sidebar-ai-usage";

test("aiUsageRowFromFreeTurns renders the trial allowance as counted turns", () => {
  assert.deepEqual(
    aiUsageRowFromFreeTurns({ limit: 5, remaining: 3, used: 2 }),
    { label: "Free msgs", percent: 40, value: "2/5" }
  );
});

test("aiUsageRowFromFreeTurns clamps percent at exhaustion", () => {
  const row = aiUsageRowFromFreeTurns({ limit: 5, remaining: 0, used: 6 });
  assert.equal(row?.percent, 100);
  assert.equal(row?.value, "6/5");
});

test("aiUsageRowFromFreeTurns omits the row for a disabled or invalid limit", () => {
  assert.equal(
    aiUsageRowFromFreeTurns({ limit: 0, remaining: 0, used: 0 }),
    null
  );
  assert.equal(
    aiUsageRowFromFreeTurns({ limit: Number.NaN, remaining: 0, used: 0 }),
    null
  );
});

test("aiUsageRowFromCredits formats micro-units as displayed credits", () => {
  assert.deepEqual(
    aiUsageRowFromCredits({
      totalMicroUnits: 3_000_000,
      usedMicroUnits: 1_200_000,
    }),
    { label: "AI Credits", percent: 40, value: "120/300" }
  );
});

test("aiUsageRowFromCredits omits the row when the plan grants no credits", () => {
  assert.equal(
    aiUsageRowFromCredits({ totalMicroUnits: 0, usedMicroUnits: 0 }),
    null
  );
});
