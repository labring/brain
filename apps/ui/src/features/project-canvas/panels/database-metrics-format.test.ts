import assert from "node:assert/strict";
import { test } from "node:test";

import { metricReading } from "./database-metrics-format";

test("metricReading hides the reading when capacity is missing", () => {
  assert.equal(
    metricReading({ capacity: undefined, kind: "cpu", percent: 42 }),
    undefined
  );
  assert.equal(
    metricReading({ capacity: undefined, kind: "memory", percent: 42 }),
    undefined
  );
  assert.equal(
    metricReading({
      capacity: undefined,
      kind: "storage",
      percent: undefined,
    }),
    undefined
  );
});

test("metricReading keeps the capacity when only usage is unknown", () => {
  assert.equal(
    metricReading({ capacity: "2", kind: "cpu", percent: undefined }),
    "-- / 2"
  );
  assert.equal(
    metricReading({ capacity: "8Gi", kind: "storage", percent: undefined }),
    "-- / 8Gi"
  );
});

test("metricReading shows used over capacity when both are known", () => {
  assert.equal(
    metricReading({ capacity: "2", kind: "cpu", percent: 50 }),
    "1 / 2"
  );
  assert.equal(
    metricReading({ capacity: "8Gi", kind: "storage", percent: 25 }),
    "2Gi / 8Gi"
  );
});
