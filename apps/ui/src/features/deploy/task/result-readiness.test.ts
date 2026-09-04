import { afterEach, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

import type { DeploymentResultResourceCard } from "./timeline";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));
const fetcher = mock(async () => ({}));
mock.module("@workspace/api/fetch", () => ({ fetcher }));
const originalFetch = globalThis.fetch;
const probeFetch = mock(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(null, { status: 200 })
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  probeFetch.mockClear();
});

const {
  observeDeploymentResultCardReadiness,
  resultReadinessForPresentation,
  waitingForResultObservationStatus,
} = requireModule("./result-readiness") as typeof import("./result-readiness");

const card: DeploymentResultResourceCard = {
  events: [],
  id: "TemplateWorkload:ns-demo:Deployment:demo-api",
  required: true,
  resultRef: {
    kind: "TemplateWorkload",
    name: "demo-api",
    namespace: "ns-demo",
    workloadKind: "Deployment",
  },
  status: "creating",
  title: "demo-api",
};

describe("result observation error presentation", () => {
  it("preserves provider details for deterministic runners", () => {
    expect(
      waitingForResultObservationStatus(
        card,
        new Error("provider-detail-token"),
        { surfaceObservationError: true }
      )
    ).toBe(
      "Waiting for Deployment demo-api observation: provider-detail-token"
    );
  });

  it("uses a fixed status when provider details must stay private", () => {
    const status = waitingForResultObservationStatus(
      card,
      new Error("provider-detail-token"),
      { surfaceObservationError: false }
    );

    expect(status).toBe("Waiting for Deployment demo-api observation.");
    expect(status).not.toContain("provider-detail-token");
  });

  it("normalizes successful provider observations for private runners", () => {
    const observed = resultReadinessForPresentation(
      card,
      {
        eventMessage: "provider-status-token",
        latestStatusText: "provider-status-token",
        status: "creating",
      },
      { surfaceObservationError: false }
    );

    expect(observed.status).toBe("creating");
    expect(observed.latestStatusText).toBe(
      "Waiting for Deployment demo-api readiness."
    );
    expect(observed.eventMessage).toBe(observed.latestStatusText);
    expect(JSON.stringify(observed)).not.toContain("provider-status-token");
  });

  it("retains successful provider observations for deterministic runners", () => {
    const observed = resultReadinessForPresentation(
      card,
      {
        eventMessage: "provider-status-token",
        latestStatusText: "provider-status-token",
        status: "creating",
      },
      { surfaceObservationError: true }
    );

    expect(observed.latestStatusText).toContain("provider-status-token");
    expect(observed.eventMessage).toContain("provider-status-token");
  });
});

it("marks a template public domain running only after its HTTP probe passes", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  const publicDomainCard: DeploymentResultResourceCard = {
    events: [],
    id: "TemplatePublicAccess:ns-demo:affine:https://affine.example.sealos.run",
    required: true,
    resultRef: {
      kind: "TemplatePublicAccess",
      name: "affine",
      namespace: "ns-demo",
      url: "https://affine.example.sealos.run",
    },
    status: "creating",
    title: "Public domain",
  };
  const deadlineAtMs = Date.now() + 10_000;

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: publicDomainCard,
    deadlineAtMs,
    kubeconfig: "unused",
  });

  expect(String(probeFetch.mock.calls[0]?.[0])).toBe(
    "https://affine.example.sealos.run/"
  );
  expect(observed.status).toBe("running");
  expect(observed.latestStatus).toBe("Public domain is reachable.");
});

it("resolves and verifies an AP-backed access endpoint before marking it running", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockResolvedValueOnce({
    status: {
      network: {
        publicAddresses: [
          {
            id: "pa_nginx",
            status: "accessible",
            url: "https://nginx.example.sealos.run",
          },
        ],
      },
    },
  });
  const deadlineAtMs = Date.now() + 10_000;

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: {
      events: [],
      id: "AccessEndpoint:ns-demo:public-address:pa_nginx",
      required: true,
      resultRef: {
        id: "public-address:pa_nginx",
        kind: "AccessEndpoint",
        label: "Public address",
        namespace: "ns-demo",
        observer: {
          addressId: "pa_nginx",
          apName: "nginx",
          kind: "ap-public-address",
        },
        protocol: "https",
      },
      status: "creating",
      title: "Public address",
    },
    deadlineAtMs,
    kubeconfig: "kubeconfig",
  });

  expect(observed.status).toBe("running");
  expect(observed.card.resultRef).toEqual({
    id: "public-address:pa_nginx",
    kind: "AccessEndpoint",
    label: "Public address",
    namespace: "ns-demo",
    observer: {
      addressId: "pa_nginx",
      apName: "nginx",
      kind: "ap-public-address",
    },
    protocol: "https",
    url: "https://nginx.example.sealos.run",
  });
  expect(String(probeFetch.mock.calls[0]?.[0])).toBe(
    "https://nginx.example.sealos.run/"
  );
});
