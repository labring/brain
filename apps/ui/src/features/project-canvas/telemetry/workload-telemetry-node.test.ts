import assert from "node:assert/strict";
import { test } from "node:test";
import {
  containerMetricsWithTelemetrySnapshot,
  databaseMetricsWithTelemetrySnapshot,
} from "./workload-telemetry-node";
import type { WorkloadTelemetrySnapshotState } from "./workload-telemetry-store";

const snapshot = {
  item: {
    metrics: {
      cpu: { value: 64 },
      storage: { value: 72 },
    },
    target: {
      kind: "db",
      name: "postgres",
      namespace: "default",
    },
  },
} satisfies WorkloadTelemetrySnapshotState;

test("workload telemetry metrics overlay stable fallback values per metric", () => {
  assert.deepEqual(
    containerMetricsWithTelemetrySnapshot(
      {
        cpu: 12,
        memory: 34,
      },
      snapshot
    ),
    {
      cpu: 64,
      memory: 34,
    }
  );

  assert.deepEqual(
    databaseMetricsWithTelemetrySnapshot(
      {
        cpu: 12,
        memory: 34,
        storage: 56,
      },
      snapshot
    ),
    {
      cpu: 64,
      memory: 34,
      storage: 72,
    }
  );
});

test("workload telemetry metrics keep stable fallback when snapshot has no metrics", () => {
  const fallback = {
    cpu: 12,
    memory: 34,
  };

  assert.equal(containerMetricsWithTelemetrySnapshot(fallback, {}), fallback);
});
