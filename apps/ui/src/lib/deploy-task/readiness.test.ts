import assert from "node:assert/strict";
import { test } from "node:test";

import { apWorkloadReadinessFromProductView } from "./readiness";

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
