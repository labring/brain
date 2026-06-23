import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkloadTelemetryStore,
  type WorkloadTelemetrySnapshotItem,
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

function telemetryItem(
  target: WorkloadTelemetryTarget,
  cpu: number,
  sampledAt: string
): WorkloadTelemetrySnapshotItem {
  return {
    metrics: { cpu: { value: cpu } },
    sampledAt,
    target,
  };
}

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

test("workload telemetry store only notifies targets with changed rendered telemetry", async () => {
  let response = {
    items: [
      telemetryItem(apTarget, 10, "2026-06-23T00:00:00Z"),
      telemetryItem(dbTarget, 20, "2026-06-23T00:00:00Z"),
    ],
  };
  const store = createWorkloadTelemetryStore({
    fetchSnapshot: async () => response,
  });
  let apNotifications = 0;
  let dbNotifications = 0;

  store.subscribe(apTarget, () => {
    apNotifications += 1;
  });
  store.subscribe(dbTarget, () => {
    dbNotifications += 1;
  });

  await store.refresh();

  assert.equal(apNotifications, 1);
  assert.equal(dbNotifications, 1);

  apNotifications = 0;
  dbNotifications = 0;
  response = {
    items: [
      telemetryItem(apTarget, 10, "2026-06-23T00:00:05Z"),
      telemetryItem(dbTarget, 25, "2026-06-23T00:00:05Z"),
    ],
  };

  await store.refresh();

  assert.equal(apNotifications, 0);
  assert.equal(dbNotifications, 1);
});
