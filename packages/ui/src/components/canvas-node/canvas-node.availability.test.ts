import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canvasNodeActionWithAvailability,
  canvasNodeLifecycleAvailability,
} from "./canvas-node.availability";

const NOUN = "Workload";

test("running resolves to stop/restart/delete enabled and start hidden", () => {
  const availability = canvasNodeLifecycleAvailability("running", NOUN);

  assert.equal(availability.start.present, false);
  assert.deepEqual(availability.stop, { present: true });
  assert.deepEqual(availability.restart, { present: true });
  assert.deepEqual(availability.delete, { present: true });
});

test("failed tones keep stop and restart usable", () => {
  for (const tone of ["degraded", "error", "failed", "unhealthy"]) {
    const availability = canvasNodeLifecycleAvailability(tone, NOUN);

    assert.equal(availability.start.present, false, tone);
    assert.deepEqual(availability.stop, { present: true }, tone);
    assert.deepEqual(availability.restart, { present: true }, tone);
  }
});

test("stopped resolves to start/delete only", () => {
  const availability = canvasNodeLifecycleAvailability("stopped", NOUN);

  assert.deepEqual(availability.start, { present: true });
  assert.equal(availability.stop.present, false);
  assert.equal(availability.restart.present, false);
  assert.deepEqual(availability.delete, { present: true });
});

test("stopping echoes the in-flight verb and disables restart", () => {
  const availability = canvasNodeLifecycleAvailability("stopping", NOUN);

  assert.equal(availability.start.present, false);
  assert.deepEqual(availability.stop, { inFlight: true, present: true });
  assert.equal(availability.restart.disabledReason, "Workload is stopping.");
  assert.deepEqual(availability.delete, { present: true });
});

test("starting echoes the in-flight verb", () => {
  const availability = canvasNodeLifecycleAvailability("starting", NOUN);

  assert.deepEqual(availability.start, { inFlight: true, present: true });
  assert.equal(availability.stop.present, false);
  assert.equal(availability.restart.disabledReason, "Workload is starting.");
});

test("restarting keeps stop visible but unavailable", () => {
  const availability = canvasNodeLifecycleAvailability("restarting", NOUN);

  assert.equal(availability.start.present, false);
  assert.equal(availability.stop.disabledReason, "Workload is restarting.");
  assert.deepEqual(availability.restart, { inFlight: true, present: true });
});

test("deleting spins delete and disables the rest", () => {
  const availability = canvasNodeLifecycleAvailability("deleting", NOUN);

  assert.deepEqual(availability.delete, { inFlight: true, present: true });
  assert.equal(availability.stop.disabledReason, "Workload is being deleted.");
  assert.equal(
    availability.restart.disabledReason,
    "Workload is being deleted."
  );
});

test("busy tones keep delete usable as the escape hatch", () => {
  for (const tone of ["creating", "pending", "reconciling", "updating"]) {
    const availability = canvasNodeLifecycleAvailability(tone, NOUN);

    assert.equal(
      availability.stop.disabledReason,
      "Workload is busy right now.",
      tone
    );
    assert.deepEqual(availability.delete, { present: true }, tone);
  }
});

test("unknown tones disable with an unknown-state reason", () => {
  for (const tone of [undefined, "", "someday-phase"]) {
    const availability = canvasNodeLifecycleAvailability(tone, NOUN);

    assert.equal(
      availability.stop.disabledReason,
      "Workload state is unknown.",
      String(tone)
    );
    assert.equal(availability.start.present, false, String(tone));
    assert.deepEqual(availability.delete, { present: true }, String(tone));
  }
});

test("tones normalize case, whitespace, and underscores", () => {
  const availability = canvasNodeLifecycleAvailability(" Stopping ", NOUN);

  assert.deepEqual(availability.stop, { inFlight: true, present: true });
});

test("host-provided session reasons win over state reasons", () => {
  const merged = canvasNodeActionWithAvailability(
    { disabled: true, disabledReason: "This project is read-only." },
    { disabledReason: "Workload is busy right now.", present: true }
  );

  assert.equal(merged.disabled, true);
  assert.equal(merged.disabledReason, "This project is read-only.");
});

test("state availability disables an otherwise enabled host action", () => {
  const merged = canvasNodeActionWithAvailability(
    { onClick: () => undefined },
    { disabledReason: "Workload is busy right now.", present: true }
  );

  assert.equal(merged.disabled, true);
  assert.equal(merged.disabledReason, "Workload is busy right now.");
  assert.equal(typeof merged.onClick, "function");
});

test("in-flight availability presents as loading", () => {
  const merged = canvasNodeActionWithAvailability(
    { onClick: () => undefined },
    { inFlight: true, present: true }
  );

  assert.equal(merged.disabled, true);
  assert.equal(merged.loading, true);
});

test("plain availability leaves an enabled host action alone", () => {
  const merged = canvasNodeActionWithAvailability(
    { onClick: () => undefined },
    { present: true }
  );

  assert.equal(merged.disabled, false);
  assert.equal(merged.loading, false);
  assert.equal(merged.disabledReason, undefined);
});
