import assert from "node:assert/strict";
import { test } from "node:test";

import {
  apWorkloadReadinessFromProductView,
  dbServiceReadinessFromProductView,
  publicAccessReadinessFromProductView,
  templateWorkloadReadinessFromProductView,
} from "./readiness";

test("AP workload readiness reaches running from workload replicas", () => {
  assert.deepEqual(
    apWorkloadReadinessFromProductView({
      metadata: { name: "api", namespace: "default" },
      status: {
        phase: "Progressing",
        readyReplicas: 2,
        replicas: 2,
      },
    }),
    {
      eventMessage: "AP workload has 2/2 ready replicas.",
      latestStatusText: "2/2 replicas ready",
      status: "running",
    }
  );
});

test("AP workload readiness excludes public access health", () => {
  assert.deepEqual(
    apWorkloadReadinessFromProductView({
      metadata: { name: "api", namespace: "default" },
      status: {
        network: {
          publicAddresses: [{ host: "api.example.com", status: "blocked" }],
        },
        phase: "Running",
        readyReplicas: 1,
        replicas: 1,
      },
    }),
    {
      eventMessage: "AP workload has 1/1 ready replicas.",
      latestStatusText: "1/1 replicas ready",
      status: "running",
    }
  );
});

test("AP workload readiness maps unavailable workload states without route health", () => {
  assert.deepEqual(
    apWorkloadReadinessFromProductView({
      status: {
        phase: "Failed",
        readyReplicas: 0,
        replicas: 1,
      },
    }),
    {
      eventMessage: "AP workload failed before reaching ready replicas.",
      latestStatusText: "Failed, 0/1 replicas ready",
      status: "failed",
    }
  );

  assert.deepEqual(
    apWorkloadReadinessFromProductView({
      status: {
        phase: "Pending",
        readyReplicas: 0,
        replicas: 1,
      },
    }),
    {
      eventMessage: "AP workload is Pending with 0/1 ready replicas.",
      latestStatusText: "Pending, 0/1 replicas ready",
      status: "creating",
    }
  );
});

test("DB Service readiness reaches running from product phase", () => {
  assert.deepEqual(
    dbServiceReadinessFromProductView({
      metadata: { name: "postgres", namespace: "default" },
      status: { phase: "Running" },
    }),
    {
      eventMessage: "DB Service is Running.",
      latestStatusText: "Running",
      status: "running",
    }
  );
});

test("template workload readiness reaches running from rollout replicas", () => {
  assert.deepEqual(
    templateWorkloadReadinessFromProductView({
      kind: "Deployment",
      metadata: { name: "wordpress", namespace: "default" },
      status: {
        readyReplicas: 2,
        replicas: 2,
      },
    }),
    {
      eventMessage: "Template workload has 2/2 ready replicas.",
      latestStatusText: "2/2 replicas ready",
      status: "running",
    }
  );
});

test("template Deployment readiness uses Ready rather than Available replicas", () => {
  assert.equal(
    templateWorkloadReadinessFromProductView({
      kind: "Deployment",
      metadata: { generation: 2 },
      spec: { replicas: 1 },
      status: {
        availableReplicas: 0,
        observedGeneration: 2,
        readyReplicas: 1,
      },
    }).status,
    "running"
  );
});

test("template DaemonSet readiness uses scheduled daemon counts", () => {
  assert.equal(
    templateWorkloadReadinessFromProductView({
      kind: "DaemonSet",
      status: { desiredNumberScheduled: 2, numberReady: 2 },
    }).status,
    "running"
  );
});

test("template CronJob readiness accepts an active schedule", () => {
  assert.deepEqual(
    templateWorkloadReadinessFromProductView({
      kind: "CronJob",
      spec: { suspend: false },
      status: {},
    }),
    {
      eventMessage: "Template CronJob schedule is active.",
      latestStatusText: "Schedule active",
      status: "running",
    }
  );
});

test("Public Address readiness reaches running from accessible route health", () => {
  assert.deepEqual(
    publicAccessReadinessFromProductView({
      host: "api.example.com",
      status: "accessible",
    }),
    {
      eventMessage: "Public Address is accessible.",
      latestStatusText: "accessible",
      status: "running",
    }
  );
});

test("result readiness maps blocked and failed states consistently", () => {
  assert.equal(
    dbServiceReadinessFromProductView({
      status: { phase: "Blocked" },
    }).status,
    "blocked"
  );
  assert.equal(
    templateWorkloadReadinessFromProductView({
      status: { phase: "Failed", readyReplicas: 0, replicas: 1 },
    }).status,
    "failed"
  );
  assert.equal(
    publicAccessReadinessFromProductView({ status: "blocked" }).status,
    "blocked"
  );
});
