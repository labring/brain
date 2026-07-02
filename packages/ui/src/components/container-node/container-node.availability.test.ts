import assert from "node:assert/strict";
import { test } from "node:test";

import { containerNodeQuickActionAvailability } from "./container-node.availability";

test("running, failed, and rolling tones keep the terminal usable", () => {
  for (const tone of [
    "running",
    "degraded",
    "error",
    "updating",
    "reconciling",
    "restarting",
  ]) {
    assert.deepEqual(containerNodeQuickActionAvailability(tone), {}, tone);
  }
});

test("stopped tones gate the terminal with a not-running reason", () => {
  for (const tone of ["paused", "stopped", "shutdown"]) {
    const availability = containerNodeQuickActionAvailability(tone);

    assert.equal(
      availability.terminal?.disabledReason,
      "Workload is not running.",
      tone
    );
  }
});

test("coming-up tones gate the terminal with a not-yet reason", () => {
  for (const tone of ["creating", "starting", "pending"]) {
    const availability = containerNodeQuickActionAvailability(tone);

    assert.equal(
      availability.terminal?.disabledReason,
      "Workload is not running yet.",
      tone
    );
  }
});

test("stopping and deleting gate the terminal with direction reasons", () => {
  assert.equal(
    containerNodeQuickActionAvailability("stopping").terminal?.disabledReason,
    "Workload is stopping."
  );
  assert.equal(
    containerNodeQuickActionAvailability("deleting").terminal?.disabledReason,
    "Workload is being deleted."
  );
});

test("unknown tones gate the terminal with an unknown-state reason", () => {
  for (const tone of [undefined, "mystery"]) {
    const availability = containerNodeQuickActionAvailability(tone);

    assert.equal(
      availability.terminal?.disabledReason,
      "Workload state is unknown.",
      String(tone)
    );
  }
});
