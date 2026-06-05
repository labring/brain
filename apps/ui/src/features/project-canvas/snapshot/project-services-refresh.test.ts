import assert from "node:assert/strict";
import { test } from "node:test";

import {
  entryPointRefreshIntervalForLifecycle,
  hasPublicApEndpoint,
  workloadListRefreshIntervalForCanvas,
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

test("entrypoint steady refresh only runs for public AP endpoints", () => {
  assert.equal(
    entryPointRefreshIntervalForLifecycle({
      apsData: { items: [] },
      entryPointsData: {
        items: [{ metadata: { name: "old-entrypoint", namespace: "default" } }],
      },
      now: 9000,
      workloadReconcilePollUntil: 0,
    }),
    0
  );
});
