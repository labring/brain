import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  isTemplateProviderAppResource,
  stampTemplateProviderDisplayNames,
} from "./template-provider-display-names";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;
const AP_ROUTE_RE = /\/api\/ap\/v1alpha1/;
const DB_ROUTE_RE = /\/api\/db\/v1alpha1/;
const AP_NAME_QUERY_RE = /name=wordpress-abcdef/;
const DB_NAME_QUERY_RE = /name=wp-mysql-x/;
const NAMESPACE_QUERY_RE = /namespace=ns-a/;

interface RecordedPatch {
  body: unknown;
  url: string;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function listResponse(items: unknown[]): Response {
  return jsonResponse({ items });
}

function mockRoutes(input: {
  apItems?: unknown[];
  dbItems?: unknown[];
  failListing?: boolean;
  failPatches?: boolean;
}): RecordedPatch[] {
  const patches: RecordedPatch[] = [];
  globalThis.fetch = ((url, init) => {
    const target = String(url);
    if (init?.method === "PATCH") {
      if (input.failPatches) {
        return Promise.resolve(new Response("boom", { status: 500 }));
      }
      patches.push({ body: JSON.parse(String(init.body)), url: target });
      return Promise.resolve(jsonResponse({}));
    }
    if (input.failListing) {
      return Promise.resolve(new Response("boom", { status: 500 }));
    }
    if (AP_ROUTE_RE.test(target)) {
      return Promise.resolve(listResponse(input.apItems ?? []));
    }
    if (DB_ROUTE_RE.test(target)) {
      return Promise.resolve(listResponse(input.dbItems ?? []));
    }
    return Promise.resolve(new Response("unexpected", { status: 404 }));
  }) as typeof fetch;
  return patches;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

test("isTemplateProviderAppResource accepts provider app resource types", () => {
  assert.equal(
    isTemplateProviderAppResource({ name: "memos", resourceType: "app" }),
    true
  );
  assert.equal(
    isTemplateProviderAppResource({
      name: "memos",
      resourceType: "Deployment",
    }),
    true
  );
  assert.equal(
    isTemplateProviderAppResource({
      name: "memos",
      resourceType: "statefulset",
    }),
    true
  );
  assert.equal(
    isTemplateProviderAppResource({ name: "memos", resourceType: "cluster" }),
    false
  );
  assert.equal(
    isTemplateProviderAppResource({ name: " ", resourceType: "app" }),
    false
  );
});

test("stamps template display names through the product PATCH routes", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({});
  await stampTemplateProviderDisplayNames({
    dbResources: [{ engine: "mysql", name: "wp-mysql-x" }],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [
      { name: "wordpress-abcdef", resourceType: "app" },
      { name: "wp-mysql-x", resourceType: "cluster" },
      { name: "wordpress-svc", resourceType: "service" },
    ],
    templateName: "wordpress",
  });
  assert.equal(patches.length, 2);
  const [apPatch, dbPatch] = patches;
  assert.match(apPatch?.url ?? "", AP_ROUTE_RE);
  assert.match(apPatch?.url ?? "", AP_NAME_QUERY_RE);
  assert.match(apPatch?.url ?? "", NAMESPACE_QUERY_RE);
  assert.deepEqual(apPatch?.body, {
    metadata: { annotations: { "brain.io/display-name": "wordpress" } },
  });
  assert.match(dbPatch?.url ?? "", DB_ROUTE_RE);
  assert.match(dbPatch?.url ?? "", DB_NAME_QUERY_RE);
  assert.deepEqual(dbPatch?.body, {
    metadata: { annotations: { "brain.io/display-name": "wordpress-mysql" } },
  });
});

test("the just-created resources never count as taken against themselves", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({
    apItems: [{ metadata: { name: "wordpress-abcdef" } }],
  });
  await stampTemplateProviderDisplayNames({
    dbResources: [],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [{ name: "wordpress-abcdef", resourceType: "app" }],
    templateName: "wordpress",
  });
  assert.deepEqual(patches[0]?.body, {
    metadata: { annotations: { "brain.io/display-name": "wordpress" } },
  });
});

test("existing project names number the whole template family", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({
    apItems: [
      {
        metadata: {
          annotations: { "brain.io/display-name": "wordpress" },
          name: "other-ap",
        },
      },
    ],
  });
  await stampTemplateProviderDisplayNames({
    dbResources: [{ engine: "mysql", name: "wp-mysql-x" }],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [
      { name: "wordpress-abcdef", resourceType: "app" },
      { name: "wp-mysql-x", resourceType: "cluster" },
    ],
    templateName: "wordpress",
  });
  assert.deepEqual(
    patches.map((patch) => patch.body),
    [
      {
        metadata: { annotations: { "brain.io/display-name": "wordpress-2" } },
      },
      {
        metadata: {
          annotations: { "brain.io/display-name": "wordpress-2-mysql" },
        },
      },
    ]
  );
});

test("an unreadable project listing skips stamping entirely", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({ failListing: true });
  await stampTemplateProviderDisplayNames({
    dbResources: [],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [{ name: "memos-abcdef", resourceType: "app" }],
    templateName: "memos",
  });
  assert.equal(patches.length, 0);
});

test("a failed display-name patch never throws", async () => {
  process.env.API_URL = "https://api.example.com";
  mockRoutes({ failPatches: true });
  await stampTemplateProviderDisplayNames({
    dbResources: [],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [{ name: "memos-abcdef", resourceType: "app" }],
    templateName: "memos",
  });
});

test("a name equal to the kubernetes name is still stamped", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({});
  await stampTemplateProviderDisplayNames({
    dbResources: [],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [{ name: "memos", resourceType: "app" }],
    templateName: "memos",
  });
  assert.deepEqual(patches[0]?.body, {
    metadata: { annotations: { "brain.io/display-name": "memos" } },
  });
});

test("resources without AP or DB classification are left alone", async () => {
  process.env.API_URL = "https://api.example.com";
  const patches = mockRoutes({});
  await stampTemplateProviderDisplayNames({
    dbResources: [],
    kubeconfig: "kubeconfig",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [
      { name: "memos-svc", resourceType: "service" },
      { name: "memos-ingress", resourceType: "ingress" },
    ],
    templateName: "memos",
  });
  assert.equal(patches.length, 0);
});
