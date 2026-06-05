import assert from "node:assert/strict";
import { test } from "node:test";
import { shouldSubscribeWorkloadTelemetry } from "./workload-telemetry-node";

test("workload telemetry subscribes only for active node surfaces", () => {
  assert.equal(
    shouldSubscribeWorkloadTelemetry({
      expanded: false,
      selected: false,
      sidePaneOpen: false,
    }),
    false
  );
  assert.equal(
    shouldSubscribeWorkloadTelemetry({
      expanded: false,
      selected: true,
      sidePaneOpen: false,
    }),
    true
  );
  assert.equal(
    shouldSubscribeWorkloadTelemetry({
      expanded: true,
      selected: false,
      sidePaneOpen: false,
    }),
    true
  );
  assert.equal(
    shouldSubscribeWorkloadTelemetry({
      expanded: false,
      selected: false,
      sidePaneOpen: true,
    }),
    true
  );
});
