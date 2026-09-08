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

it("propagates task cancellation to a historical template public probe", async () => {
  let probeWasAborted: boolean | undefined;
  globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
    probeWasAborted = init?.signal?.aborted;
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as unknown as typeof fetch;
  const controller = new AbortController();
  controller.abort(new Error("cancelled by task"));

  await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: {
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
    },
    deadlineAtMs: Date.now() + 10_000,
    kubeconfig: "unused",
    signal: controller.signal,
  });

  expect(probeWasAborted).toBe(true);
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

it.each([
  {
    observer: "ingress",
    pathStatus: 404,
    rootStatus: 200,
    ready: true,
    calls: 2,
  },
  {
    observer: "ingress",
    pathStatus: 404,
    rootStatus: 404,
    ready: false,
    calls: 2,
  },
  {
    observer: "ingress",
    pathStatus: 503,
    rootStatus: 200,
    ready: false,
    calls: 1,
  },
  {
    observer: "declared",
    pathStatus: 404,
    rootStatus: 200,
    ready: false,
    calls: 1,
  },
] as const)("probes a root fallback only for inferred Ingress 404s: %j", async ({
  observer,
  pathStatus,
  rootStatus,
  ready,
  calls,
}) => {
  const requests: string[] = [];
  globalThis.fetch = ((url: RequestInfo | URL) => {
    requests.push(String(url));
    return Promise.resolve(
      new Response(null, {
        status:
          new URL(String(url)).pathname === "/api" ? pathStatus : rootStatus,
      })
    );
  }) as typeof fetch;
  const endpoint: DeploymentResultResourceCard = {
    events: [],
    id: "inferred-api",
    required: true,
    resultRef: {
      id: "inferred-api",
      kind: "AccessEndpoint",
      label: "Web address /api",
      namespace: "ns-demo",
      observer:
        observer === "ingress"
          ? { kind: "ingress", name: "demo-admin" }
          : { kind: "declared" },
      protocol: "https",
      url: "https://demo.example.sealos.run/api",
    },
    status: "creating",
    title: "Web address /api",
  };
  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: endpoint,
    kubeconfig: "kubeconfig",
  });
  expect(observed.running).toBe(ready);
  expect(requests).toHaveLength(calls);
  expect(observed.card.id).toBe(endpoint.id);
  if (ready) {
    expect(observed.card.title).toBe("Web address");
    expect(observed.card.resultRef).toMatchObject({
      label: "Web address",
      url: "https://demo.example.sealos.run/",
    });
    expect(observed.eventMessage).toBe("Web address is reachable.");
  } else {
    expect(observed.card.resultRef).toEqual(endpoint.resultRef);
  }
});

it("names an AP-backed endpoint after the App Listening Port it reaches", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockResolvedValueOnce({
    status: {
      network: {
        appListeningPorts: [{ displayName: "game", port: 5200 }],
        publicAddresses: [
          {
            host: "game.example.sealos.run",
            id: "pa_game",
            port: 5200,
            status: "accessible",
            type: "platform",
            url: "https://game.example.sealos.run/",
          },
        ],
      },
    },
  });

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: {
      events: [],
      id: "AccessEndpoint:ns-demo:public-address:pa_game",
      required: true,
      resultRef: {
        id: "public-address:pa_game",
        kind: "AccessEndpoint",
        label: "Public address",
        namespace: "ns-demo",
        observer: {
          addressId: "pa_game",
          apName: "eaglercraft",
          kind: "ap-public-address",
        },
        protocol: "https",
      },
      status: "creating",
      title: "Public address",
    },
    deadlineAtMs: Date.now() + 10_000,
    kubeconfig: "kubeconfig",
  });

  expect(observed.status).toBe("running");
  expect(observed.card.title).toBe("game · 5200");
  expect(observed.card.resultRef).toMatchObject({
    label: "game · 5200",
    url: "https://game.example.sealos.run/",
  });
  expect(observed.eventMessage).toBe("game · 5200 is reachable.");
});

it("names an unnamed port's endpoint by its number alone", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockResolvedValueOnce({
    status: {
      network: {
        appListeningPorts: [{ port: 8080 }],
        publicAddresses: [
          {
            host: "nginx.example.sealos.run",
            id: "pa_nginx",
            port: 8080,
            status: "accessible",
            type: "platform",
            url: "https://nginx.example.sealos.run/",
          },
        ],
      },
    },
  });

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
    deadlineAtMs: Date.now() + 10_000,
    kubeconfig: "kubeconfig",
  });

  expect(observed.card.resultRef).toMatchObject({ label: "8080" });
});

it("names an Ingress endpoint through the task's AP that observed its host", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  // The first candidate does not know the host; the second does.
  fetcher
    .mockResolvedValueOnce({
      status: { network: { appListeningPorts: [], publicAddresses: [] } },
    })
    .mockResolvedValueOnce({
      status: {
        network: {
          appListeningPorts: [{ displayName: "Admin console", port: 3000 }],
          publicAddresses: [
            {
              host: "demo.example.sealos.run",
              id: "observed-1",
              port: 3000,
              status: "accessible",
              type: "observed",
              url: "https://demo.example.sealos.run/admin",
            },
          ],
        },
      },
    });

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    apCandidates: [
      { name: "sidecar", namespace: "ns-demo" },
      { name: "demo", namespace: "ns-demo" },
    ],
    card: {
      events: [],
      id: "inferred-admin",
      required: true,
      resultRef: {
        id: "inferred-admin",
        kind: "AccessEndpoint",
        label: "Web address /admin",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "demo-admin" },
        protocol: "https",
        url: "https://demo.example.sealos.run/admin",
      },
      status: "creating",
      title: "Web address /admin",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.running).toBe(true);
  expect(observed.card.resultRef).toMatchObject({
    label: "Admin console · 3000",
    url: "https://demo.example.sealos.run/admin",
  });
});

it("heads a same-host Ingress endpoint by the port its URL reaches, not the first row for the host", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockResolvedValueOnce({
    status: {
      network: {
        appListeningPorts: [
          { displayName: "game", port: 5200 },
          { displayName: "admin", port: 8081 },
        ],
        publicAddresses: [
          {
            host: "demo.example.sealos.run",
            id: "observed-game",
            port: 5200,
            status: "accessible",
            type: "observed",
            url: "wss://demo.example.sealos.run/",
          },
          {
            host: "demo.example.sealos.run",
            id: "observed-admin",
            port: 8081,
            status: "accessible",
            type: "observed",
            url: "https://demo.example.sealos.run/admin",
          },
        ],
      },
    },
  });

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    apCandidates: [{ name: "demo", namespace: "ns-demo" }],
    card: {
      events: [],
      id: "inferred-admin",
      required: true,
      resultRef: {
        id: "inferred-admin",
        kind: "AccessEndpoint",
        label: "Web address /admin",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "demo-admin" },
        protocol: "https",
        url: "https://demo.example.sealos.run/admin",
      },
      status: "creating",
      title: "Web address /admin",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.running).toBe(true);
  expect(observed.card.resultRef).toMatchObject({ label: "admin · 8081" });
});

it("keeps the Ingress label when no AP of the task knows the host", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockRejectedValueOnce(new Error("AP not found"));

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    apCandidates: [{ name: "raw-deployment", namespace: "ns-demo" }],
    card: {
      events: [],
      id: "inferred-root",
      required: true,
      resultRef: {
        id: "inferred-root",
        kind: "AccessEndpoint",
        label: "Web address",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "demo" },
        protocol: "https",
        url: "https://demo.example.sealos.run/",
      },
      status: "creating",
      title: "Web address",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.running).toBe(true);
  expect(observed.card.resultRef).toMatchObject({ label: "Web address" });
});

it("probes a Template Entry share address verbatim, query string included, and keeps its own label", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockClear();
  const host = "eagler-demo.example.sealos.run";
  const share = `https://${host}/?server=wss://${host}/`;

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    apCandidates: [{ name: "eaglercraft", namespace: "ns-demo" }],
    card: {
      events: [],
      id: "AccessEndpoint:ns-demo:template-entry:share",
      required: false,
      resultRef: {
        id: "template-entry:share",
        kind: "AccessEndpoint",
        label: "Share address",
        namespace: "ns-demo",
        observer: { entry: "share", kind: "template-entry" },
        protocol: "https",
        url: share,
      },
      status: "creating",
      title: "Share address",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.status).toBe("running");
  expect(probeFetch).toHaveBeenCalledTimes(1);
  expect(String(probeFetch.mock.calls[0]?.[0])).toBe(share);
  // A Share entry is never renamed after a port; the AP view is not even read.
  expect(fetcher).not.toHaveBeenCalled();
  expect(observed.card.resultRef).toMatchObject({
    label: "Share address",
    url: share,
  });
});

it("names a Template Entry Open address after the App Listening Port it reaches, without root discovery", async () => {
  globalThis.fetch = probeFetch as unknown as typeof fetch;
  fetcher.mockResolvedValueOnce({
    status: {
      network: {
        appListeningPorts: [
          { displayName: "game", port: 5200 },
          { displayName: "admin", port: 5201 },
        ],
        publicAddresses: [
          {
            host: "eagler-demo.example.sealos.run",
            id: "observed-1",
            port: 5200,
            status: "accessible",
            type: "observed",
            url: "wss://eagler-demo.example.sealos.run/",
          },
          {
            host: "eagler-demo.example.sealos.run",
            id: "observed-2",
            port: 5201,
            status: "accessible",
            type: "observed",
            url: "https://eagler-demo.example.sealos.run/admin",
          },
        ],
      },
    },
  });

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    apCandidates: [{ name: "eaglercraft", namespace: "ns-demo" }],
    card: {
      events: [],
      id: "AccessEndpoint:ns-demo:template-entry:open",
      required: false,
      resultRef: {
        id: "template-entry:open",
        kind: "AccessEndpoint",
        label: "Web address",
        namespace: "ns-demo",
        observer: { entry: "open", kind: "template-entry" },
        protocol: "https",
        url: "https://eagler-demo.example.sealos.run/admin",
      },
      status: "creating",
      title: "Web address",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.status).toBe("running");
  expect(observed.card.resultRef).toMatchObject({
    label: "admin · 5201",
    url: "https://eagler-demo.example.sealos.run/admin",
  });
});

it("never verifies a declared Template Entry through a root it did not declare", async () => {
  probeFetch.mockImplementationOnce(
    async () => new Response(null, { status: 404 })
  );
  globalThis.fetch = probeFetch as unknown as typeof fetch;

  const observed = await observeDeploymentResultCardReadiness({
    allowedDomain: "example.sealos.run",
    card: {
      events: [],
      id: "AccessEndpoint:ns-demo:template-entry:open",
      required: false,
      resultRef: {
        id: "template-entry:open",
        kind: "AccessEndpoint",
        label: "Web address",
        namespace: "ns-demo",
        observer: { entry: "open", kind: "template-entry" },
        protocol: "https",
        url: "https://eagler-demo.example.sealos.run/admin",
      },
      status: "creating",
      title: "Web address",
    },
    kubeconfig: "kubeconfig",
  });

  expect(observed.status).toBe("unknown");
  expect(probeFetch).toHaveBeenCalledTimes(1);
});
