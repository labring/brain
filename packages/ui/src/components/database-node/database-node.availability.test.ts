import assert from "node:assert/strict";
import { test } from "node:test";

import { databaseNodeQuickActionAvailability } from "./database-node.availability";

test("running tones keep terminal and db access usable", () => {
  for (const tone of ["running", "ready", "available"]) {
    assert.deepEqual(databaseNodeQuickActionAvailability(tone), {}, tone);
  }
});

test("live sessions gate together outside running", () => {
  const availability = databaseNodeQuickActionAvailability("stopped");

  assert.equal(
    availability.terminal?.disabledReason,
    "Database is not running."
  );
  assert.equal(
    availability.dbAccess?.disabledReason,
    "Database is not running."
  );
  assert.equal(availability.logs, undefined);
  assert.equal(availability.metrics, undefined);
});

test("failed tones gate live sessions with a not-ready reason", () => {
  for (const tone of ["failed", "degraded", "unhealthy"]) {
    const availability = databaseNodeQuickActionAvailability(tone);

    assert.equal(
      availability.terminal?.disabledReason,
      "Database is not ready.",
      tone
    );
  }
});

test("transient tones gate live sessions with direction reasons", () => {
  assert.equal(
    databaseNodeQuickActionAvailability("starting").terminal?.disabledReason,
    "Database is starting."
  );
  assert.equal(
    databaseNodeQuickActionAvailability("stopping").terminal?.disabledReason,
    "Database is stopping."
  );
  assert.equal(
    databaseNodeQuickActionAvailability("creating").terminal?.disabledReason,
    "Database is busy right now."
  );
});

test("unknown tones gate live sessions with an unknown-state reason", () => {
  for (const tone of [undefined, "not-configured"]) {
    const availability = databaseNodeQuickActionAvailability(tone);

    assert.equal(
      availability.terminal?.disabledReason,
      "Database state is unknown.",
      String(tone)
    );
  }
});
