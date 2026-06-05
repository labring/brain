import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkloadTelemetryStore,
  type WorkloadTelemetryTarget,
} from "./workload-telemetry-store";

const apTarget: WorkloadTelemetryTarget = {
  kind: "ap",
  name: "api",
  namespace: "default",
};
const dbTarget: WorkloadTelemetryTarget = {
  kind: "db",
  name: "postgres",
  namespace: "default",
};

test("workload telemetry store reports whether active targets exist", () => {
  const store = createWorkloadTelemetryStore({
    fetchSnapshot: async () => ({ items: [] }),
  });

  assert.equal(store.hasActiveTargets(), false);
  const unsubscribe = store.subscribe(apTarget, () => undefined);
  assert.equal(store.hasActiveTargets(), true);
  unsubscribe();
  assert.equal(store.hasActiveTargets(), false);
});

test("workload telemetry store batches same-tick first subscriptions", async () => {
  const requests: WorkloadTelemetryTarget[][] = [];
  const store = createWorkloadTelemetryStore({
    autoRefresh: true,
    fetchSnapshot: (targets) => {
      requests.push(targets);
      return Promise.resolve({ items: [] });
    },
  });

  store.subscribe(apTarget, () => undefined);
  store.subscribe(dbTarget, () => undefined);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], [apTarget, dbTarget]);
});
