import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasPublicApEndpoint,
  trackedWorkloadRefreshInterval,
  WORKLOAD_LIST_BACKGROUND_REFRESH_MS,
  WORKLOAD_LIST_FAST_REFRESH_MS,
  WORKLOAD_LIST_MEDIUM_REFRESH_MS,
  WORKLOAD_LIST_STUCK_REFRESH_MS,
  workloadListRefreshIntervalForCanvas,
  workloadTransientRefreshIntervalForAge,
} from "./project-services-refresh";

test("public AP endpoint detection includes Network public addresses", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              publicAddresses: [
                {
                  host: "api.example.com",
                  id: "pa_abc123",
                  port: 8080,
                  url: "https://api.example.com/",
                },
              ],
            },
          },
        },
      ],
    }),
    true
  );
});

test("public AP endpoint detection includes desired Platform Address requests", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              network: {
                privatePort: 8080,
                platformAddresses: [{ id: "pa_abc123", port: 8080 }],
              },
            },
          },
          status: {
            network: {
              privatePort: 8080,
            },
          },
        },
      ],
    }),
    true
  );
});

test("public AP detection ignores retired endpoint fields", () => {
  assert.equal(
    hasPublicApEndpoint({
      items: [
        {
          metadata: { name: "api", namespace: "default" },
          spec: {
            input: {
              endpoints: [{ host: "api.example.com", port: 8080 }],
            },
          },
          status: {
            endpoints: [
              {
                number: 8080,
                publicAddress: "https://api.example.com/",
              },
            ],
          },
        },
      ],
    }),
    false
  );
});

test("workload list refresh polls empty discovery only inside the startup window", () => {
  const emptyList = { items: [] };

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 10_000,
      latestData: emptyList,
      now: 9000,
      peerEmpty: true,
      workloadReconcilePollUntil: 0,
    }),
    1000
  );

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 10_000,
      latestData: emptyList,
      now: 10_001,
      peerEmpty: true,
      workloadReconcilePollUntil: 0,
    }),
    0
  );
});

test("workload transient age backs off from fast to medium to stuck refresh", () => {
  assert.equal(workloadTransientRefreshIntervalForAge(10_000), 1000);
  assert.equal(workloadTransientRefreshIntervalForAge(90_000), 5000);
  assert.equal(workloadTransientRefreshIntervalForAge(6 * 60_000), 10_000);
});

test("workload list refresh tracks transient age per resource", () => {
  const transientSinceByKey = new Map<string, number>();

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      latestData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default", uid: "db-1" },
            status: { phase: "Creating" },
          },
        ],
      },
      now: 100_000,
      peerEmpty: false,
      resourceKind: "db",
      transientSinceByKey,
      workloadReconcilePollUntil: 0,
    }),
    WORKLOAD_LIST_FAST_REFRESH_MS
  );

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      latestData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default", uid: "db-1" },
            status: { phase: "Reconciling" },
          },
        ],
      },
      now: 170_001,
      peerEmpty: false,
      resourceKind: "db",
      transientSinceByKey,
      workloadReconcilePollUntil: 0,
    }),
    WORKLOAD_LIST_MEDIUM_REFRESH_MS
  );

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      latestData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default", uid: "db-1" },
            status: { phase: "Updating" },
          },
        ],
      },
      now: 410_001,
      peerEmpty: false,
      resourceKind: "db",
      transientSinceByKey,
      workloadReconcilePollUntil: 0,
    }),
    WORKLOAD_LIST_STUCK_REFRESH_MS
  );
});

test("workload list refresh uses the most urgent resource interval", () => {
  const transientSinceByKey = new Map<string, number>([
    ["db/default/stuck/db-stuck", 0],
  ]);

  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      latestData: {
        items: [
          {
            metadata: { name: "stuck", namespace: "default", uid: "db-stuck" },
            status: { phase: "Reconciling" },
          },
          {
            metadata: { name: "fresh", namespace: "default", uid: "db-fresh" },
            status: { phase: "Creating" },
          },
        ],
      },
      now: 400_000,
      peerEmpty: false,
      resourceKind: "db",
      transientSinceByKey,
      workloadReconcilePollUntil: 0,
    }),
    WORKLOAD_LIST_FAST_REFRESH_MS
  );
});

test("workload list refresh clears transient age after a stable phase", () => {
  const transientSinceByKey = new Map<string, number>();
  const transientList = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default", uid: "db-1" },
        status: { phase: "Creating" },
      },
    ],
  };
  const stableList = {
    items: [
      {
        metadata: { name: "postgres", namespace: "default", uid: "db-1" },
        status: { phase: "Running" },
      },
    ],
  };

  trackedWorkloadRefreshInterval({
    latestData: transientList,
    now: 100_000,
    resourceKind: "db",
    transientSinceByKey,
  });
  assert.equal(transientSinceByKey.size, 1);

  assert.equal(
    trackedWorkloadRefreshInterval({
      latestData: stableList,
      now: 110_000,
      resourceKind: "db",
      transientSinceByKey,
    }),
    0
  );
  assert.equal(transientSinceByKey.size, 0);

  assert.equal(
    trackedWorkloadRefreshInterval({
      latestData: transientList,
      now: 120_000,
      resourceKind: "db",
      transientSinceByKey,
    }),
    WORKLOAD_LIST_FAST_REFRESH_MS
  );
});

test("workload list refresh does not reset transient age on transient subphase changes", () => {
  const transientSinceByKey = new Map<string, number>();
  trackedWorkloadRefreshInterval({
    latestData: {
      items: [
        {
          metadata: { name: "postgres", namespace: "default", uid: "db-1" },
          status: { phase: "Creating" },
        },
      ],
    },
    now: 100_000,
    resourceKind: "db",
    transientSinceByKey,
  });

  assert.equal(
    trackedWorkloadRefreshInterval({
      latestData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default", uid: "db-1" },
            status: { phase: "Reconciling" },
          },
        ],
      },
      now: 170_001,
      resourceKind: "db",
      transientSinceByKey,
    }),
    WORKLOAD_LIST_MEDIUM_REFRESH_MS
  );
});

test("background workload list refresh keeps active polling at a 30s floor", () => {
  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      isPageVisible: false,
      latestData: {
        items: [
          {
            metadata: { name: "postgres", namespace: "default", uid: "db-1" },
            status: { phase: "Creating" },
          },
        ],
      },
      now: 100_000,
      peerEmpty: false,
      resourceKind: "db",
      transientSinceByKey: new Map<string, number>(),
      workloadReconcilePollUntil: 0,
    }),
    WORKLOAD_LIST_BACKGROUND_REFRESH_MS
  );
});

test("workload list refresh keeps fast polling during reconcile windows", () => {
  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      latestData: { items: [] },
      now: 9000,
      peerEmpty: true,
      workloadReconcilePollUntil: 10_000,
    }),
    1000
  );
});

test("background workload list refresh keeps idle lists stopped", () => {
  assert.equal(
    workloadListRefreshIntervalForCanvas({
      discoveryPollUntil: 0,
      isPageVisible: false,
      latestData: { items: [] },
      now: 9000,
      peerEmpty: true,
      workloadReconcilePollUntil: 0,
    }),
    0
  );
});
