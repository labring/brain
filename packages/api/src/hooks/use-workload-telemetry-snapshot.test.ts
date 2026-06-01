import assert from "node:assert/strict";
import { test } from "node:test";

import { API_ROUTES } from "../constants";
import { buildWorkloadTelemetrySnapshotRequest } from "./use-workload-telemetry-snapshot";

test("workload telemetry snapshot request posts all targets with kubeconfig auth", () => {
  const got = buildWorkloadTelemetrySnapshotRequest({
    kubeconfig: "kubeconfig",
    targets: [
      { kind: "ap", namespace: "project-a", name: "web" },
      { kind: "db", namespace: "project-a", name: "pg" },
    ],
  });

  assert.equal(got.enabled, true);
  assert.equal(got.path, API_ROUTES.telemetry.metricsSnapshot);
  assert.equal(got.method, "POST");
  assert.deepEqual(got.header, { Authorization: "Bearer kubeconfig" });
  assert.deepEqual(got.body, {
    targets: [
      { kind: "ap", namespace: "project-a", name: "web" },
      { kind: "db", namespace: "project-a", name: "pg" },
    ],
  });
});
