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

function installCluster(
  objects: Record<string, Record<string, unknown>>,
  options: { patchStatus?: number } = {}
) {
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
      return Promise.resolve(
        options.patchStatus === undefined
          ? Response.json({})
          : new Response("forbidden", { status: options.patchStatus })
      );
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

// As the provider summarizes a catalog deployment: the workload and its
// Ingresses, no Service. The Service is reached through the Ingress backends.
const RESOURCES = [
  { name: "eaglercraft", resourceType: "StatefulSet", uid: "1" },
  { name: "eaglercraft", resourceType: "ingress", uid: "3" },
  { name: "eaglercraft-admin", resourceType: "Ingress", uid: "4" },
];

function providerSourceResponse(templateYaml: unknown) {
  return Response.json({
    code: 200,
    data: {
      appYaml: "kind: Deployment",
      source: {
        defaults: {},
        inputs: [{ default: "Lobby", key: "server_name" }],
      },
      templateYaml,
    },
  });
}

function readBack(args: Record<string, string> | undefined) {
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
      Promise.resolve(providerSourceResponse(TEMPLATE_YAML));
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

  it("drops an input-bound entry instead of rendering it from the default when no args are in hand", async () => {
    installCluster(clusterObjects());

    const entries = await readBack(undefined);

    // Open substitutes no input and renders; Share names `inputs.server_name`
    // and is dropped rather than snapshotted with "Lobby".
    expect(entries).toEqual({ open: `https://${HOST}/admin` });
    expect(patches.map((patch) => patch.body)).toEqual([
      { metadata: { annotations: { "brain.io/default-open-port": "5201" } } },
    ]);
  });

  it("degrades to no entries when the provider source cannot be read", async () => {
    providerSource = () => Promise.reject(new Error("provider down"));
    installCluster(clusterObjects());

    await expect(readBack({})).resolves.toBeUndefined();
    expect(patches).toEqual([]);
  });

  it("reads the entries off an inline YAML template source as well as a parsed one", async () => {
    providerSource = () =>
      Promise.resolve(
        providerSourceResponse(
          [
            "apiVersion: app.sealos.io/v1",
            "kind: Template",
            "metadata:",
            "  name: eaglercraft-server",
            "spec:",
            "  entries:",
            `    open: https://${APP_HOST_EXPRESSION}/admin`,
            "---",
            "apiVersion: v1",
            "kind: Service",
          ].join("\n")
        )
      );
    installCluster(clusterObjects());

    const entries = await readBack({});

    expect(entries).toEqual({ open: `https://${HOST}/admin` });
    expect(patches.map((patch) => patch.body)).toEqual([
      { metadata: { annotations: { "brain.io/default-open-port": "5201" } } },
    ]);
  });

  it("keeps the resolved entries when the Default Open Port PATCH fails", async () => {
    installCluster(clusterObjects(), { patchStatus: 403 });
    const warn = console.warn;
    const warnings: unknown[][] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const entries = await readBack({ server_name: "My Server" });

      expect(entries).toEqual({
        open: `https://${HOST}/admin`,
        share: `https://${HOST}/?server=wss://${HOST}/&name=My Server`,
      });
      expect(patches).toHaveLength(1);
      expect(String(warnings[0]?.[0])).toContain("Default Open Port");
    } finally {
      console.warn = warn;
    }
  });

  it("presets the Open Entry's App CR launcher URL and leaves Share empty", async () => {
    providerSource = () =>
      Promise.resolve(
        providerSourceResponse({ ...TEMPLATE_YAML, spec: { title: "x" } })
      );
    const objects = clusterObjects();
    objects.apps = {
      eaglercraft: {
        apiVersion: "app.sealos.io/v1",
        kind: "App",
        metadata: { name: "eaglercraft" },
        spec: { data: { url: `https://${HOST}/#token=abc` } },
      },
    };
    installCluster(objects);

    const entries = await readBack({});

    expect(entries).toEqual({ open: `https://${HOST}/#token=abc` });
    // The fragment is client-side: the root rule's port is preset.
    expect(patches.map((patch) => patch.body)).toEqual([
      { metadata: { annotations: { "brain.io/default-open-port": "5200" } } },
    ]);
  });
});
