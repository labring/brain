import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyApReadinessToResultCard,
  apResultResourceCardsFromArtifactSummary,
} from "./direct-timeline";

test("direct deployment timeline creates no AP card before AP result evidence is known", () => {
  assert.deepEqual(apResultResourceCardsFromArtifactSummary({}), []);
  assert.deepEqual(
    apResultResourceCardsFromArtifactSummary({
      resources: [
        {
          apiVersion: "brain.io/direct",
          kind: "DB",
          name: "postgres",
          namespace: "default",
        },
      ],
    }),
    []
  );
});

test("direct deployment timeline creates required AP result cards from artifact evidence", () => {
  assert.deepEqual(
    apResultResourceCardsFromArtifactSummary({
      resources: [
        {
          apiVersion: "brain.io/direct",
          kind: "AP",
          name: "api",
          namespace: "default",
        },
      ],
    }),
    [
      {
        events: [],
        id: "AP:default:api",
        required: true,
        resultRef: { kind: "AP", name: "api", namespace: "default" },
        status: "creating",
        title: "api",
      },
    ]
  );
});

test("direct deployment timeline applies AP workload readiness to the AP card", () => {
  const [card] = apResultResourceCardsFromArtifactSummary({
    resources: [
      {
        apiVersion: "brain.io/direct",
        kind: "AP",
        name: "api",
        namespace: "default",
      },
    ],
  });
  assert.ok(card);

  assert.deepEqual(
    applyApReadinessToResultCard(card, {
      eventMessage: "AP workload has 1/1 ready replicas.",
      latestStatusText: "1/1 replicas ready",
      status: "running",
    }),
    {
      events: [],
      id: "AP:default:api",
      latestStatusText: "1/1 replicas ready",
      required: true,
      resultRef: { kind: "AP", name: "api", namespace: "default" },
      status: "running",
      title: "api",
    }
  );
});
