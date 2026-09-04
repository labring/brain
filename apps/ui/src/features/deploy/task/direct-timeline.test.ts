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

test("deployment timeline creates deduplicated public domain cards from template Ingress rules", () => {
  const cards = resultResourceCardsFromArtifactSummary({
    resources: [
      {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        name: "affine",
        namespace: "ns-demo",
      },
    ],
    resourceYamls: [
      `
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: affine
spec:
  tls:
    - hosts:
        - affine.example.sealos.run
  rules:
    - host: affine.example.sealos.run
      http:
        paths:
          - path: /
    - host: status.example.sealos.run
      http:
        paths:
          - path: /status
    - host: status.example.sealos.run
      http:
        paths:
          - path: /status
    - host: "*.example.sealos.run"
    - host: invalid/path
`,
    ],
  });

  assert.deepEqual(cards, [
    {
      events: [],
      id: "AccessEndpoint:ns-demo:ingress:affine:https:affine.example.sealos.run:/",
      required: true,
      resultRef: {
        id: "ingress:affine:https:affine.example.sealos.run:/",
        kind: "AccessEndpoint",
        label: "Web address",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "affine" },
        protocol: "https",
        url: "https://affine.example.sealos.run/",
      },
      status: "creating",
      title: "Web address",
    },
    {
      events: [],
      id: "AccessEndpoint:ns-demo:ingress:affine:http:status.example.sealos.run:/status",
      required: true,
      resultRef: {
        id: "ingress:affine:http:status.example.sealos.run:/status",
        kind: "AccessEndpoint",
        label: "Web address /status",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "affine" },
        protocol: "http",
        url: "http://status.example.sealos.run/status",
      },
      status: "creating",
      title: "Web address /status",
    },
  ]);
});

test("deployment timeline creates required Access Endpoint cards from AP network evidence", () => {
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
        id: "AccessEndpoint:default:public-address:pa_api",
        required: true,
        resultRef: {
          id: "public-address:pa_api",
          kind: "AccessEndpoint",
          label: "Public address",
          namespace: "default",
          observer: {
            addressId: "pa_api",
            apName: "api",
            kind: "ap-public-address",
          },
          protocol: "https",
        },
        status: "creating",
        title: "Public address",
      },
    ]
  );
});

test("deployment timeline lets an explicitly optional endpoint stay optional", () => {
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
          required: false
`,
    ],
  });

  assert.equal(cards[0]?.id, "AccessEndpoint:default:public-address:pa_api");
  assert.equal(cards[0]?.required, false);
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
