import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

// The provider source and every cluster read go through globalThis.fetch,
// stubbed here instead of mock.module("@workspace/api/fetch"): a module mock
// outlives its file in one bun run and would poison later consumers of the
// fetch module (see runner.template-preserve.test.ts).

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const { templateProviderTemplateEntries } = requireModule(
  "./template-provider-entries"
) as typeof import("./template-provider-entries");

const TEMPLATE_EXPRESSION_START = String.fromCharCode(36, 123, 123);
const APP_HOST_EXPRESSION = `${TEMPLATE_EXPRESSION_START} defaults.app_host }}.${TEMPLATE_EXPRESSION_START} SEALOS_CLOUD_DOMAIN }}`;
const HOST = "eagler-demo.example.sealos.run";
const TEMPLATE_YAML = {
  apiVersion: "app.sealos.io/v1",
  kind: "Template",
  metadata: { name: "eaglercraft-server" },
  spec: {
    entries: {
      open: `https://${APP_HOST_EXPRESSION}/admin`,
      share: `https://${APP_HOST_EXPRESSION}/?server=wss://${APP_HOST_EXPRESSION}/&name=${TEMPLATE_EXPRESSION_START} inputs.server_name }}`,
    },
    title: "EaglerCraft Server",
  },
};

const originalFetch = globalThis.fetch;
const originalProviderUrl = process.env.TEMPLATE_PROVIDER_URL;

interface RecordedPatch {
  body: unknown;
  query: Record<string, string>;
}

const patches: RecordedPatch[] = [];
let providerSource: () => Promise<Response> = () =>
  Promise.resolve(new Response(null, { status: 500 }));

function installCluster(objects: Record<string, Record<string, unknown>>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/api/getTemplateSource")) {
      return providerSource();
    }
    const query = Object.fromEntries(url.searchParams.entries());
    if (url.pathname.endsWith("/api/k8s/v1alpha1/patch")) {
      patches.push({
        body: JSON.parse(String(init?.body ?? "null")),
        query,
      });
      return Promise.resolve(Response.json({}));
    }
    if (url.pathname.endsWith("/api/k8s/v1alpha1/get")) {
      const object = objects[query.kind ?? ""]?.[query.name ?? ""];
      return Promise.resolve(
        object == null
          ? new Response("not found", { status: 404 })
          : Response.json(object)
      );
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as unknown as typeof fetch;
}

function clusterObjects(input: { preset?: string } = {}) {
  return {
    apps: {
      eaglercraft: {
        apiVersion: "app.sealos.io/v1",
        kind: "App",
        metadata: { name: "eaglercraft" },
        spec: { data: { url: `https://${HOST}/admin` } },
      },
    },
    ingresses: {
      eaglercraft: {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "eaglercraft" },
        spec: {
          rules: [
            {
              host: HOST,
              http: {
                paths: [
                  {
                    backend: {
                      service: { name: "eaglercraft", port: { number: 5200 } },
                    },
                    path: "/",
                    pathType: "Prefix",
                  },
                ],
              },
            },
          ],
        },
      },
      "eaglercraft-admin": {
        apiVersion: "networking.k8s.io/v1",
        kind: "Ingress",
        metadata: { name: "eaglercraft-admin" },
        spec: {
          rules: [
            {
              host: HOST,
              http: {
                paths: [
                  {
                    backend: {
                      service: { name: "eaglercraft", port: { number: 5201 } },
                    },
                    path: "/admin",
                    pathType: "Prefix",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    instances: {
      eaglercraft: {
        apiVersion: "app.sealos.io/v1",
        kind: "Instance",
        metadata: { name: "eaglercraft" },
        spec: {
          defaults: {
            app_host: { type: "string", value: "eagler-demo" },
            app_name: { type: "string", value: "eaglercraft" },
          },
        },
      },
    },
    services: {
      eaglercraft: {
        apiVersion: "v1",
        kind: "Service",
        metadata: {
          name: "eaglercraft",
          ...(input.preset === undefined
            ? {}
            : { annotations: { "brain.io/default-open-port": input.preset } }),
        },
        spec: {
          ports: [
            { name: "game", port: 5200 },
            { name: "admin", port: 5201 },
          ],
        },
      },
    },
  } as Record<string, Record<string, unknown>>;
}

const RESOURCES = [
  { name: "eaglercraft", resourceType: "deployment", uid: "1" },
  { name: "eaglercraft", resourceType: "service", uid: "2" },
  { name: "eaglercraft", resourceType: "ingress", uid: "3" },
  { name: "eaglercraft-admin", resourceType: "ingress", uid: "4" },
];

function readBack(args: Record<string, string>) {
  return templateProviderTemplateEntries({
    args,
    instanceName: "eaglercraft",
    kubeconfig: "kubeconfig",
    namespace: "ns-demo",
    resources: RESOURCES,
    routingDomain: "example.sealos.run",
    templateName: "eaglercraft-server",
  });
}

describe("templateProviderTemplateEntries", () => {
  beforeEach(() => {
    process.env.TEMPLATE_PROVIDER_URL = "https://provider.test";
    patches.length = 0;
    providerSource = () =>
      Promise.resolve(
        Response.json({
          code: 200,
          data: {
            appYaml: "kind: Deployment",
            source: {
              defaults: {},
              inputs: [{ default: "Lobby", key: "server_name" }],
            },
            templateYaml: TEMPLATE_YAML,
          },
        })
      );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalProviderUrl === undefined) {
      Reflect.deleteProperty(process.env, "TEMPLATE_PROVIDER_URL");
    } else {
      process.env.TEMPLATE_PROVIDER_URL = originalProviderUrl;
    }
  });

  it("reads resolved defaults off the Instance, renders the entries, and presets the Default Open Port", async () => {
    installCluster(clusterObjects());

    const entries = await readBack({ server_name: "My Server" });

    expect(entries).toEqual({
      open: `https://${HOST}/admin`,
      share: `https://${HOST}/?server=wss://${HOST}/&name=My Server`,
    });
    expect(patches).toEqual([
      {
        body: {
          metadata: {
            annotations: { "brain.io/default-open-port": "5201" },
          },
        },
        query: {
          kind: "services",
          name: "eaglercraft",
          namespace: "ns-demo",
          type: "merge",
        },
      },
    ]);
  });

  it("leaves a Service the template already preset alone", async () => {
    installCluster(clusterObjects({ preset: "5200" }));

    const entries = await readBack({});

    expect(entries?.open).toBe(`https://${HOST}/admin`);
    expect(patches).toEqual([]);
  });

  it("falls back to the App CR url for Open only when the Instance defaults are unresolved", async () => {
    const objects = clusterObjects();
    objects.instances = {};
    installCluster(objects);

    const entries = await readBack({});

    // `${{ defaults.app_host }}` rendered empty: neither entry names an
    // Ingress host, so Open comes from the App CR and Share is absent.
    expect(entries).toEqual({ open: `https://${HOST}/admin` });
  });

  it("degrades to no entries when the provider source cannot be read", async () => {
    providerSource = () => Promise.reject(new Error("provider down"));
    installCluster(clusterObjects());

    await expect(readBack({})).resolves.toBeUndefined();
    expect(patches).toEqual([]);
  });
});
