import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  dbLabelValuesForCluster,
  isTemplateProviderClusterResource,
  normalizeTemplateProviderDbResources,
  templateProviderDbLabels,
} from "./template-provider-db-labels";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;
const K8S_GET_PATH_RE = /\/api\/k8s\/v1alpha1\/get/;
const K8S_PATCH_PATH_RE = /\/api\/k8s\/v1alpha1\/patch/;
const CLUSTERS_KIND_QUERY_RE = /kind=clusters/;
const AIRBYTE_CLUSTER_NAME_QUERY_RE = /name=airbyte-pg/;
const NAMESPACE_QUERY_RE = /namespace=ns-a/;
const MERGE_PATCH_TYPE_QUERY_RE = /type=merge/;

function headerValue(
  headers: HeadersInit | undefined,
  key: string
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get(key) ?? undefined;
  }
  if (Array.isArray(headers)) {
    return new Headers(headers).get(key) ?? undefined;
  }
  return headers?.[key];
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

test("isTemplateProviderClusterResource accepts provider cluster resource names", () => {
  assert.equal(
    isTemplateProviderClusterResource({
      name: "airbyte-pg",
      resourceType: "cluster",
    }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({
      name: "airbyte-pg",
      resourceType: "Cluster",
    }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({
      name: "airbyte-pg",
      resourceType: "kubeblockscluster",
    }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({
      name: "airbyte",
      resourceType: "deployment",
    }),
    false
  );
  assert.equal(
    isTemplateProviderClusterResource({ name: "", resourceType: "cluster" }),
    false
  );
});

test("dbLabelValuesForCluster infers PostgreSQL labels from kb.io database", () => {
  const values = dbLabelValuesForCluster({
    apiVersion: "apps.kubeblocks.io/v1alpha1",
    kind: "Cluster",
    metadata: {
      labels: {
        "kb.io/database": "postgresql-16.4.0",
      },
      name: "airbyte-pg",
    },
    spec: {},
  });

  assert.deepEqual(values, {
    definition: "postgresql",
    engine: "postgresql",
    version: "postgresql-16.4.0",
  });
});

test("dbLabelValuesForCluster supports provider template database variants", () => {
  const cases: Array<{
    cluster: unknown;
    expected: { definition?: string; engine?: string; version?: string };
    name: string;
  }> = [
    {
      cluster: {
        metadata: { labels: {}, name: "bytebase-pg" },
        spec: {
          clusterDefinitionRef: "postgresql",
          clusterVersionRef: "postgresql-14.8.0",
        },
      },
      expected: {
        definition: "postgresql",
        engine: "postgresql",
        version: "postgresql-14.8.0",
      },
      name: "postgres 14 from spec",
    },
    {
      cluster: {
        metadata: {
          labels: { "kb.io/database": "ac-mysql-8.0.30-1" },
          name: "wordpress-mysql",
        },
        spec: {},
      },
      expected: {
        definition: "apecloud-mysql",
        engine: "mysql",
        version: "ac-mysql-8.0.30-1",
      },
      name: "apecloud mysql from kb.io database",
    },
    {
      cluster: {
        metadata: {
          labels: {
            "clusterdefinition.kubeblocks.io/name": "redis",
            "clusterversion.kubeblocks.io/name": "redis-7.2.7",
          },
          name: "chatwoot-redis",
        },
      },
      expected: {
        definition: "redis",
        engine: "redis",
        version: "redis-7.2.7",
      },
      name: "redis from labels",
    },
    {
      cluster: {
        metadata: { labels: {}, name: "laf-mongo" },
        spec: {
          clusterDefinitionRef: "mongodb",
          clusterVersionRef: "mongodb-6.0",
        },
      },
      expected: {
        definition: "mongodb",
        engine: "mongodb",
        version: "mongodb-6.0",
      },
      name: "mongodb from spec",
    },
  ];

  for (const item of cases) {
    assert.deepEqual(
      dbLabelValuesForCluster(item.cluster),
      item.expected,
      item.name
    );
  }
});

test("templateProviderDbLabels adds Brain ownership and DB provider labels", () => {
  const labels = templateProviderDbLabels({
    cluster: {
      metadata: {
        labels: {
          "clusterdefinition.kubeblocks.io/name": "postgresql",
          "clusterversion.kubeblocks.io/name": "postgresql-14.8.0",
        },
        name: "reactive-resume-pg",
      },
    },
    instanceName: "reactive-resume-abc123",
    projectId: "project-uid",
    templateName: "Reactive-Resume",
  });

  assert.deepEqual(labels, {
    "app.kubernetes.io/instance": "reactive-resume-pg",
    "brain.io/db-engine": "postgresql",
    "brain.io/deployment-kind": "template",
    "brain.io/deployment-name": "reactive-resume-abc123",
    "brain.io/managed-by": "brain",
    "brain.io/project-id": "project-uid",
    "brain.io/template-name": "Reactive-Resume",
    "clusterdefinition.kubeblocks.io/name": "postgresql",
    "clusterversion.kubeblocks.io/name": "postgresql-14.8.0",
  });
});

test("templateProviderDbLabels skips clusters without a DB definition", () => {
  const labels = templateProviderDbLabels({
    cluster: {
      metadata: {
        labels: {},
        name: "unknown-cluster",
      },
    },
    instanceName: "unknown-demo",
    projectId: "project-uid",
    templateName: "unknown",
  });

  assert.deepEqual(labels, {});
});

test("normalizeTemplateProviderDbResources patches provider cluster labels", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{
    authorization?: string;
    body?: unknown;
    method?: string;
    url: string;
  }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
      authorization: headerValue(init?.headers, "Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      method: init?.method,
      url: String(url),
    });
    if (String(url).includes("/api/k8s/v1alpha1/get")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "apps.kubeblocks.io/v1alpha1",
            kind: "Cluster",
            metadata: {
              labels: {
                "kb.io/database": "postgresql-16.4.0",
              },
              name: "airbyte-pg",
              namespace: "ns-a",
            },
            spec: {},
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      );
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  const normalized = await normalizeTemplateProviderDbResources({
    encodedKubeconfig: "kubeconfig",
    instanceName: "airbyte-demo",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [
      { name: "airbyte", resourceType: "deployment" },
      { name: "airbyte-pg", resourceType: "cluster" },
    ],
    templateName: "airbyte",
  });

  assert.deepEqual(normalized, [{ engine: "postgresql", name: "airbyte-pg" }]);
  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", K8S_GET_PATH_RE);
  assert.match(calls[0]?.url ?? "", CLUSTERS_KIND_QUERY_RE);
  assert.match(calls[0]?.url ?? "", AIRBYTE_CLUSTER_NAME_QUERY_RE);
  assert.match(calls[0]?.url ?? "", NAMESPACE_QUERY_RE);
  assert.equal(calls[0]?.authorization, "Bearer kubeconfig");
  assert.equal(calls[1]?.method, "PATCH");
  assert.match(calls[1]?.url ?? "", K8S_PATCH_PATH_RE);
  assert.match(calls[1]?.url ?? "", CLUSTERS_KIND_QUERY_RE);
  assert.match(calls[1]?.url ?? "", AIRBYTE_CLUSTER_NAME_QUERY_RE);
  assert.match(calls[1]?.url ?? "", NAMESPACE_QUERY_RE);
  assert.match(calls[1]?.url ?? "", MERGE_PATCH_TYPE_QUERY_RE);
  assert.deepEqual(calls[1]?.body, {
    metadata: {
      labels: {
        "app.kubernetes.io/instance": "airbyte-pg",
        "brain.io/db-engine": "postgresql",
        "brain.io/deployment-kind": "template",
        "brain.io/deployment-name": "airbyte-demo",
        "brain.io/managed-by": "brain",
        "brain.io/project-id": "project-uid",
        "brain.io/template-name": "airbyte",
        "clusterdefinition.kubeblocks.io/name": "postgresql",
        "clusterversion.kubeblocks.io/name": "postgresql-16.4.0",
      },
    },
  });
});

test("normalizeTemplateProviderDbResources skips non-cluster provider resources", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: string[] = [];
  globalThis.fetch = ((url) => {
    calls.push(String(url));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  await normalizeTemplateProviderDbResources({
    encodedKubeconfig: "kubeconfig",
    instanceName: "n8n-demo",
    namespace: "ns-a",
    projectId: "project-uid",
    resources: [{ name: "n8n-demo", resourceType: "app" }],
    templateName: "n8n",
  });

  assert.deepEqual(calls, []);
});
