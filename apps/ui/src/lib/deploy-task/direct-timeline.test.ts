import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyApReadinessToResultCard,
  apResultResourceCardsFromArtifactSummary,
  resultResourceCardsFromArtifactSummary,
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

test("direct deployment timeline creates required DB result cards from DB evidence", () => {
  assert.deepEqual(
    resultResourceCardsFromArtifactSummary({
      resources: [
        {
          apiVersion: "brain.io/direct",
          kind: "DB",
          name: "postgres",
          namespace: "default",
        },
      ],
    }),
    [
      {
        events: [],
        id: "DB:default:postgres",
        required: true,
        resultRef: { kind: "DB", name: "postgres", namespace: "default" },
        status: "creating",
        title: "postgres",
      },
    ]
  );
});

test("deployment timeline creates template workload cards without support object cards", () => {
  assert.deepEqual(
    resultResourceCardsFromArtifactSummary({
      resources: [
        {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: "wordpress",
          namespace: "default",
        },
        {
          apiVersion: "v1",
          kind: "Service",
          name: "wordpress",
          namespace: "default",
        },
      ],
    }),
    [
      {
        events: [],
        id: "TemplateWorkload:default:Deployment:wordpress",
        required: true,
        resultRef: {
          kind: "TemplateWorkload",
          name: "wordpress",
          namespace: "default",
          workloadKind: "Deployment",
        },
        status: "creating",
        title: "wordpress",
      },
    ]
  );
});

test("deployment timeline creates optional Public Address cards from AP network evidence", () => {
  const cards = resultResourceCardsFromArtifactSummary({
    resources: [
      {
        apiVersion: "brain.io/direct",
        kind: "AP",
        name: "api",
        namespace: "default",
      },
    ],
    resourceYamls: [
      `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: api
  namespace: default
spec:
  input:
    network:
      platformAddresses:
        - id: pa_api
          port: 80
`,
    ],
  });

  assert.deepEqual(
    cards.map((card) => ({
      id: card.id,
      required: card.required,
      resultRef: card.resultRef,
      status: card.status,
      title: card.title,
    })),
    [
      {
        id: "AP:default:api",
        required: true,
        resultRef: { kind: "AP", name: "api", namespace: "default" },
        status: "creating",
        title: "api",
      },
      {
        id: "PublicAccess:default:api:pa_api",
        required: false,
        resultRef: {
          apName: "api",
          id: "pa_api",
          kind: "PublicAccess",
          namespace: "default",
        },
        status: "creating",
        title: "Public access",
      },
    ]
  );
});

test("deployment timeline marks Public Address cards required only from explicit evidence", () => {
  const cards = resultResourceCardsFromArtifactSummary({
    resourceYamls: [
      `
apiVersion: brain.io/direct
kind: AP
metadata:
  name: api
  namespace: default
spec:
  input:
    network:
      platformAddresses:
        - id: pa_api
          port: 80
          required: true
`,
    ],
  });

  assert.equal(cards[0]?.id, "PublicAccess:default:api:pa_api");
  assert.equal(cards[0]?.required, true);
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
