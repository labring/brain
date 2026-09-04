import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, test } from "node:test";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const { templateProviderPublicAccessCards } = requireModule(
  "./template-provider-public-access"
) as typeof import("./template-provider-public-access");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

test("template provider ingress resources become one verified public-domain card per URL", async () => {
  process.env.API_URL = "https://api.example.com";
  const requests: URL[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    const name = url.searchParams.get("name");
    const websocket = name === "eaglercraft-demo";
    return Promise.resolve(
      Response.json({
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: {
          annotations: websocket
            ? { "nginx.ingress.kubernetes.io/backend-protocol": "WS" }
            : {},
          name,
          namespace: "ns-demo",
        },
        spec: {
          rules: [
            {
              host: "eaglercraft-demo.example.sealos.run",
              http: {
                paths: websocket ? [{ path: "/" }] : [{ path: "/admin" }],
              },
            },
          ],
          tls: [{ hosts: ["eaglercraft-demo.example.sealos.run"] }],
        },
      })
    );
  }) as typeof fetch;

  const cards = await templateProviderPublicAccessCards({
    kubeconfig: "kubeconfig-for-tests",
    namespace: "ns-demo",
    resources: [
      { name: "eaglercraft-demo", resourceType: "StatefulSet", uid: "1" },
      { name: "eaglercraft-demo", resourceType: "ingress", uid: "2" },
      { name: "eaglercraft-demo-admin", resourceType: "Ingress", uid: "3" },
    ],
  });

  assert.deepEqual(
    requests.map((url) => ({
      kind: url.searchParams.get("kind"),
      name: url.searchParams.get("name"),
      namespace: url.searchParams.get("namespace"),
    })),
    [
      { kind: "ingresses", name: "eaglercraft-demo", namespace: "ns-demo" },
      {
        kind: "ingresses",
        name: "eaglercraft-demo-admin",
        namespace: "ns-demo",
      },
    ]
  );
  assert.deepEqual(cards, [
    {
      events: [],
      id: "AccessEndpoint:ns-demo:ingress:eaglercraft-demo:https:eaglercraft-demo.example.sealos.run:/",
      required: true,
      resultRef: {
        id: "ingress:eaglercraft-demo:https:eaglercraft-demo.example.sealos.run:/",
        kind: "AccessEndpoint",
        label: "Web address",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "eaglercraft-demo" },
        protocol: "https",
        url: "https://eaglercraft-demo.example.sealos.run/",
      },
      status: "creating",
      title: "Web address",
    },
    {
      events: [],
      id: "AccessEndpoint:ns-demo:ingress:eaglercraft-demo:wss:eaglercraft-demo.example.sealos.run:/",
      required: true,
      resultRef: {
        id: "ingress:eaglercraft-demo:wss:eaglercraft-demo.example.sealos.run:/",
        kind: "AccessEndpoint",
        label: "WebSocket address",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "eaglercraft-demo" },
        protocol: "wss",
        url: "wss://eaglercraft-demo.example.sealos.run/",
      },
      status: "creating",
      title: "WebSocket address",
    },
    {
      events: [],
      id: "AccessEndpoint:ns-demo:ingress:eaglercraft-demo-admin:https:eaglercraft-demo.example.sealos.run:/admin",
      required: true,
      resultRef: {
        id: "ingress:eaglercraft-demo-admin:https:eaglercraft-demo.example.sealos.run:/admin",
        kind: "AccessEndpoint",
        label: "Web address /admin",
        namespace: "ns-demo",
        observer: { kind: "ingress", name: "eaglercraft-demo-admin" },
        protocol: "https",
        url: "https://eaglercraft-demo.example.sealos.run/admin",
      },
      status: "creating",
      title: "Web address /admin",
    },
  ]);
});

test("template provider ingress observation retries transient failures", async () => {
  process.env.API_URL = "https://api.example.com";
  let attempts = 0;
  globalThis.fetch = (() => {
    attempts += 1;
    if (attempts === 1) {
      return Promise.reject(new TypeError("not ready"));
    }
    return Promise.resolve(
      Response.json({
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "demo", namespace: "ns-demo" },
        spec: {
          rules: [
            {
              host: "demo.example.sealos.run",
              http: { paths: [{ path: "/" }] },
            },
          ],
        },
      })
    );
  }) as unknown as typeof fetch;

  const cards = await templateProviderPublicAccessCards({
    kubeconfig: "kubeconfig-for-tests",
    namespace: "ns-demo",
    pollIntervalMs: 1,
    resources: [{ name: "demo", resourceType: "Ingress", uid: "1" }],
    signal: new AbortController().signal,
  });

  assert.equal(attempts, 2);
  assert.equal(cards[0]?.resultRef.kind, "AccessEndpoint");
});
