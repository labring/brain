# Template Provider DB Label Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure newly deployed Sealos provider templates with embedded KubeBlocks `Cluster` resources are labeled so Brain's `/db` discovery returns them and the project canvas shows DB nodes.

**Architecture:** Keep the existing provider deployment path, then run a Brain-side post-deploy normalization pass over provider-returned Cluster resources. The pass patches only namespaced KubeBlocks `clusters` returned by the provider for this deployment, adding the DB provider labels required by Brain discovery plus the existing Brain deployment ownership labels.

**Tech Stack:** Bun 1.3.5, TypeScript, Next.js server code, `@workspace/api` fetcher/constants, Go API `/api/k8s/v1alpha1/get` and `/api/k8s/v1alpha1/patch`, Node/Bun `node:test`-style tests.

## Global Constraints

- Package manager: `bun 1.3.5` only; do not use npm/pnpm/yarn.
- Node version: Node >=20.
- Scope excludes backfill or compatibility handling for existing deployments; fix new deployments only.
- Do not relax `/api/db/v1alpha1` discovery ownership rules.
- Do not rely on `kb.io/database` alone for Brain ownership.
- Keep changes in `apps/ui/src/lib`; no new external dependencies.
- Before claiming code work is done, run `bun typecheck` and `bun check`; run focused tests for touched behavior.

---

## File Structure

- Create `apps/ui/src/lib/template-provider-db-labels.ts`
  - Owns provider-deployed KubeBlocks Cluster label normalization.
  - Exports pure helpers for tests and one async integration function used by the deployment runner.
  - Talks to existing Go K8s get/patch endpoints via `fetcher`, `API_ROUTES`, and `ApiUrl`.

- Create `apps/ui/src/lib/template-provider-db-labels.test.ts`
  - Unit tests engine/definition/version inference and provider resource filtering.
  - Integration-style fetch mock tests that verify get + merge patch calls.

- Modify `apps/ui/src/lib/deploy-task/runner.ts`
  - Imports `normalizeTemplateProviderDbResources`.
  - Calls it immediately after `deployTemplateInstance(...)` succeeds and before returning the `template-instance` artifact.

No Go API changes are needed because `/api/k8s/v1alpha1/patch` already supports `type=merge`, and `/api/db/v1alpha1` already discovers DBs once the labels are present.

---

### Task 1: Add Pure DB Label Normalization Helpers

**Files:**
- Create: `apps/ui/src/lib/template-provider-db-labels.ts`
- Test: `apps/ui/src/lib/template-provider-db-labels.test.ts`

**Interfaces:**
- Produces:
  - `export interface TemplateProviderResourceSummary { name: string; resourceType: string; uid?: string }`
  - `export function isTemplateProviderClusterResource(resource: TemplateProviderResourceSummary): boolean`
  - `export function dbLabelValuesForCluster(cluster: unknown): { definition?: string; engine?: string; version?: string }`
  - `export function templateProviderDbLabels(input: { cluster: unknown; instanceName: string; projectId: string; templateName: string }): Record<string, string>`

- [ ] **Step 1: Create the failing tests for filtering and PostgreSQL inference**

Create `apps/ui/src/lib/template-provider-db-labels.test.ts` with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dbLabelValuesForCluster,
  isTemplateProviderClusterResource,
  templateProviderDbLabels,
} from "./template-provider-db-labels";

test("isTemplateProviderClusterResource accepts provider cluster resource names", () => {
  assert.equal(
    isTemplateProviderClusterResource({ name: "airbyte-pg", resourceType: "cluster" }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({ name: "airbyte-pg", resourceType: "Cluster" }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({ name: "airbyte-pg", resourceType: "kubeblockscluster" }),
    true
  );
  assert.equal(
    isTemplateProviderClusterResource({ name: "airbyte", resourceType: "deployment" }),
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
```

Expected: FAIL with module not found for `./template-provider-db-labels`.

- [ ] **Step 3: Implement the pure helpers**

Create `apps/ui/src/lib/template-provider-db-labels.ts` with:

```ts
import {
  BRAIN_DB_ENGINE_LABEL,
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  DB_PROVIDER_CLUSTER_DEFINITION_LABEL,
  DB_PROVIDER_CLUSTER_VERSION_LABEL,
  DB_PROVIDER_INSTANCE_LABEL,
} from "@/lib/brain-labels";

export interface TemplateProviderResourceSummary {
  name: string;
  resourceType: string;
  uid?: string;
}

const CLUSTER_RESOURCE_TYPES = new Set([
  "cluster",
  "clusters",
  "kubeblockscluster",
  "kubeblocksclusters",
]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function metadataRecord(cluster: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(cluster)?.metadata);
}

function specRecord(cluster: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(cluster)?.spec);
}

function metadataName(cluster: unknown): string | undefined {
  return stringValue(metadataRecord(cluster)?.name);
}

function metadataLabels(cluster: unknown): Record<string, unknown> {
  return asRecord(metadataRecord(cluster)?.labels) ?? {};
}

function engineFromDefinition(definition: string | undefined): string | undefined {
  switch (definition) {
    case "postgresql":
      return "postgresql";
    case "apecloud-mysql":
    case "mysql":
      return "mysql";
    case "redis":
      return "redis";
    case "mongodb":
      return "mongodb";
    default:
      return undefined;
  }
}

function definitionFromKbDatabase(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("postgresql-") || normalized === "postgresql") {
    return "postgresql";
  }
  if (normalized.startsWith("redis-") || normalized === "redis") {
    return "redis";
  }
  if (normalized.startsWith("mongodb-") || normalized === "mongodb") {
    return "mongodb";
  }
  if (normalized.startsWith("ac-mysql-") || normalized === "apecloud-mysql") {
    return "apecloud-mysql";
  }
  if (normalized.startsWith("mysql-") || normalized === "mysql") {
    return "mysql";
  }
  return undefined;
}

function versionFromKbDatabase(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return /\d/.test(value) ? value : undefined;
}

export function isTemplateProviderClusterResource(
  resource: TemplateProviderResourceSummary
): boolean {
  return (
    resource.name.trim() !== "" &&
    CLUSTER_RESOURCE_TYPES.has(resource.resourceType.trim().toLowerCase())
  );
}

export function dbLabelValuesForCluster(cluster: unknown): {
  definition?: string;
  engine?: string;
  version?: string;
} {
  const labels = metadataLabels(cluster);
  const spec = specRecord(cluster);
  const kbDatabase = stringValue(labels["kb.io/database"]);
  const definition =
    stringValue(labels[DB_PROVIDER_CLUSTER_DEFINITION_LABEL]) ??
    stringValue(spec?.clusterDefinitionRef) ??
    definitionFromKbDatabase(kbDatabase);
  const version =
    stringValue(labels[DB_PROVIDER_CLUSTER_VERSION_LABEL]) ??
    stringValue(spec?.clusterVersionRef) ??
    versionFromKbDatabase(kbDatabase);
  const engine = engineFromDefinition(definition);
  return {
    ...(definition === undefined ? {} : { definition }),
    ...(engine === undefined ? {} : { engine }),
    ...(version === undefined ? {} : { version }),
  };
}

export function templateProviderDbLabels(input: {
  cluster: unknown;
  instanceName: string;
  projectId: string;
  templateName: string;
}): Record<string, string> {
  const values = dbLabelValuesForCluster(input.cluster);
  const name = metadataName(input.cluster);
  return {
    ...(name === undefined ? {} : { [DB_PROVIDER_INSTANCE_LABEL]: name }),
    [BRAIN_MANAGED_BY_LABEL]: BRAIN_MANAGED_BY_VALUE,
    [BRAIN_PROJECT_ID_LABEL]: input.projectId,
    [BRAIN_DEPLOYMENT_KIND_LABEL]: "template",
    [BRAIN_DEPLOYMENT_NAME_LABEL]: input.instanceName,
    [BRAIN_TEMPLATE_NAME_LABEL]: input.templateName,
    ...(values.engine === undefined ? {} : { [BRAIN_DB_ENGINE_LABEL]: values.engine }),
    ...(values.definition === undefined
      ? {}
      : { [DB_PROVIDER_CLUSTER_DEFINITION_LABEL]: values.definition }),
    ...(values.version === undefined
      ? {}
      : { [DB_PROVIDER_CLUSTER_VERSION_LABEL]: values.version }),
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
```

Expected: PASS for the three tests added in this task.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/lib/template-provider-db-labels.ts apps/ui/src/lib/template-provider-db-labels.test.ts
git commit -m "feat(template): infer db labels for provider clusters"
```

---

### Task 2: Patch Provider-Deployed Cluster Labels

**Files:**
- Modify: `apps/ui/src/lib/template-provider-db-labels.ts`
- Modify: `apps/ui/src/lib/template-provider-db-labels.test.ts`

**Interfaces:**
- Consumes:
  - `TemplateProviderResourceSummary`
  - `isTemplateProviderClusterResource(resource)`
  - `templateProviderDbLabels(input)`
- Produces:
  - `export async function normalizeTemplateProviderDbResources(input: { encodedKubeconfig: string; instanceName: string; namespace: string; projectId: string; resources: TemplateProviderResourceSummary[]; templateName: string }): Promise<void>`

- [ ] **Step 1: Add failing fetch tests for get + merge patch**

Append to `apps/ui/src/lib/template-provider-db-labels.test.ts`:

```ts
import { afterEach } from "node:test";
import { normalizeTemplateProviderDbResources } from "./template-provider-db-labels";

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

test("normalizeTemplateProviderDbResources patches provider cluster labels", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{
    authorization?: string;
    body?: unknown;
    contentType?: string;
    method?: string;
    url: string;
  }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      contentType: (init?.headers as Record<string, string> | undefined)?.["Content-Type"],
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

  await normalizeTemplateProviderDbResources({
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

  assert.equal(calls.length, 2);
  assert.match(calls[0]?.url ?? "", /\/api\/k8s\/v1alpha1\/get/);
  assert.match(calls[0]?.url ?? "", /kind=clusters/);
  assert.match(calls[0]?.url ?? "", /name=airbyte-pg/);
  assert.match(calls[0]?.url ?? "", /namespace=ns-a/);
  assert.equal(calls[0]?.authorization, "Bearer kubeconfig");
  assert.equal(calls[1]?.method, "PATCH");
  assert.match(calls[1]?.url ?? "", /\/api\/k8s\/v1alpha1\/patch/);
  assert.match(calls[1]?.url ?? "", /kind=clusters/);
  assert.match(calls[1]?.url ?? "", /name=airbyte-pg/);
  assert.match(calls[1]?.url ?? "", /namespace=ns-a/);
  assert.match(calls[1]?.url ?? "", /type=merge/);
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
```

If the import block now imports `test` twice, consolidate the first line to:

```ts
import { afterEach, test } from "node:test";
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
```

Expected: FAIL because `normalizeTemplateProviderDbResources` is not exported.

- [ ] **Step 3: Implement K8s get + merge patch**

Append imports to `apps/ui/src/lib/template-provider-db-labels.ts`:

```ts
import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
```

Add this function near the bottom of `apps/ui/src/lib/template-provider-db-labels.ts`:

```ts
function authHeader(encodedKubeconfig: string): Record<string, string> {
  return { Authorization: `Bearer ${encodeURIComponent(encodedKubeconfig)}` };
}

async function getKubeBlocksCluster(input: {
  encodedKubeconfig: string;
  name: string;
  namespace: string;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: authHeader(input.encodedKubeconfig),
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      kind: "clusters",
      name: input.name,
      namespace: input.namespace,
    },
  });
}

async function patchKubeBlocksClusterLabels(input: {
  encodedKubeconfig: string;
  labels: Record<string, string>;
  name: string;
  namespace: string;
}): Promise<void> {
  if (Object.keys(input.labels).length === 0) {
    return;
  }
  await fetcher({
    base: ApiUrl(),
    body: { metadata: { labels: input.labels } },
    header: authHeader(input.encodedKubeconfig),
    method: "PATCH",
    path: API_ROUTES.k8s.patch,
    query: {
      kind: "clusters",
      name: input.name,
      namespace: input.namespace,
      type: "merge",
    },
  });
}

export async function normalizeTemplateProviderDbResources(input: {
  encodedKubeconfig: string;
  instanceName: string;
  namespace: string;
  projectId: string;
  resources: TemplateProviderResourceSummary[];
  templateName: string;
}): Promise<void> {
  for (const resource of input.resources) {
    if (!isTemplateProviderClusterResource(resource)) {
      continue;
    }
    const name = resource.name.trim();
    const cluster = await getKubeBlocksCluster({
      encodedKubeconfig: input.encodedKubeconfig,
      name,
      namespace: input.namespace,
    });
    const labels = templateProviderDbLabels({
      cluster,
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    });
    await patchKubeBlocksClusterLabels({
      encodedKubeconfig: input.encodedKubeconfig,
      labels,
      name,
      namespace: input.namespace,
    });
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/lib/template-provider-db-labels.ts apps/ui/src/lib/template-provider-db-labels.test.ts
git commit -m "fix(template): normalize provider db cluster labels"
```

---

### Task 3: Wire Normalization Into Provider Template Deployment

**Files:**
- Modify: `apps/ui/src/lib/deploy-task/runner.ts`
- Test: add focused test if `apps/ui/src/lib/deploy-task/runner.test.ts` has an existing template runner test; otherwise rely on Task 2 unit coverage and verify by static import/typecheck.

**Interfaces:**
- Consumes:
  - `normalizeTemplateProviderDbResources(input)` from Task 2.
- Produces:
  - `generateTemplateArtifact(...)` normalizes provider Cluster labels before returning a `template-instance` artifact.

- [ ] **Step 1: Add the import**

In `apps/ui/src/lib/deploy-task/runner.ts`, add:

```ts
import { normalizeTemplateProviderDbResources } from "@/lib/template-provider-db-labels";
```

Place it near the other template imports:

```ts
import { applyRenderedTemplateDeployment } from "@/lib/template-k8s-apply";
import { normalizeTemplateProviderDbResources } from "@/lib/template-provider-db-labels";
import {
  deployTemplateInstance,
  getTemplateSource,
} from "@/lib/template-provider-core";
```

- [ ] **Step 2: Call normalization after provider deploy succeeds**

In `generateTemplateArtifact(...)`, change the body from:

```ts
  const deployed = await deployTemplateInstance({
    args: input.args,
    encodedKubeconfig: input.encodedKubeconfig,
    extraLabels: templateDeploymentExtraLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    }),
    instanceName: input.instanceName,
    templateName: input.templateName,
  });
  return {
    instanceName: deployed.instanceName,
    kind: "template-instance",
    resources: deployed.resources,
    templateName: input.templateName,
  };
```

to:

```ts
  const deployed = await deployTemplateInstance({
    args: input.args,
    encodedKubeconfig: input.encodedKubeconfig,
    extraLabels: templateDeploymentExtraLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    }),
    instanceName: input.instanceName,
    templateName: input.templateName,
  });
  await normalizeTemplateProviderDbResources({
    encodedKubeconfig: input.encodedKubeconfig,
    instanceName: deployed.instanceName,
    namespace: input.task.namespace,
    projectId: input.projectId,
    resources: deployed.resources,
    templateName: input.templateName,
  });
  return {
    instanceName: deployed.instanceName,
    kind: "template-instance",
    resources: deployed.resources,
    templateName: input.templateName,
  };
```

If the current `generateTemplateArtifact` input type does not include `task`, add `namespace: string` to its input instead and pass `namespace: input.task.namespace` from the caller. Prefer the smallest edit that matches the current file.

- [ ] **Step 3: Verify TypeScript compile for runner changes**

Run:

```bash
bun typecheck
```

Expected: PASS. If it fails because `generateTemplateArtifact` currently lacks `task`, adjust the function signature to include `namespace: string` and pass it at the call site:

```ts
const artifact = await generateTemplateArtifact({
  args: mergedArgs,
  encodedKubeconfig: input.encodedKubeconfig,
  instanceName,
  namespace: input.task.namespace,
  projectId: input.projectId,
  templateName,
});
```

Then call normalization with `namespace: input.namespace`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
bun test apps/ui/src/lib/template-provider.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ui/src/lib/deploy-task/runner.ts
git commit -m "fix(deploy-task): normalize template provider db resources"
```

---

### Task 4: Broaden Engine Coverage Tests

**Files:**
- Modify: `apps/ui/src/lib/template-provider-db-labels.test.ts`

**Interfaces:**
- Consumes:
  - `dbLabelValuesForCluster(cluster)` from Task 1.

- [ ] **Step 1: Add tests for MySQL, Redis, MongoDB, and spec fallbacks**

Append to `apps/ui/src/lib/template-provider-db-labels.test.ts`:

```ts
test("dbLabelValuesForCluster supports provider template database variants", () => {
  const cases: Array<{
    cluster: unknown;
    expected: { definition?: string; engine?: string; version?: string };
    name: string;
  }> = [
    {
      name: "postgres 14 from spec",
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
    },
    {
      name: "apecloud mysql from kb.io database",
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
    },
    {
      name: "redis from labels",
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
    },
    {
      name: "mongodb from spec",
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
    },
  ];

  for (const item of cases) {
    assert.deepEqual(dbLabelValuesForCluster(item.cluster), item.expected, item.name);
  }
});
```

- [ ] **Step 2: Run the focused test**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/ui/src/lib/template-provider-db-labels.test.ts
git commit -m "test(template): cover provider db label variants"
```

---

### Task 5: Final Verification

**Files:**
- No code changes expected.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified implementation ready for review.

- [ ] **Step 1: Run focused tests**

Run:

```bash
bun test apps/ui/src/lib/template-provider-db-labels.test.ts
bun test apps/ui/src/lib/template-provider.test.ts
bun test apps/ui/src/lib/template-k8s-apply.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run repository typecheck**

Run:

```bash
bun typecheck
```

Expected: PASS.

- [ ] **Step 3: Run repository code quality check**

Run:

```bash
bun check
```

Expected: PASS.

- [ ] **Step 4: Manual smoke validation in a development cluster**

Deploy a template known to include a KubeBlocks DB, such as `airbyte`, through the Brain template deploy UI. After deployment completes, run:

```bash
kubectl get clusters.apps.kubeblocks.io -n <namespace> --show-labels | grep airbyte
```

Expected labels include:

```txt
app.kubernetes.io/instance=<cluster-name>
clusterdefinition.kubeblocks.io/name=postgresql
brain.io/managed-by=brain
brain.io/project-id=<project-id>
brain.io/deployment-kind=template
brain.io/template-name=airbyte
```

Then run:

```bash
kubectl get clusters.apps.kubeblocks.io -n <namespace> \
  -l 'app.kubernetes.io/instance,clusterdefinition.kubeblocks.io/name,brain.io/managed-by=brain,brain.io/project-id=<project-id>' \
  --show-labels
```

Expected: the Airbyte PostgreSQL Cluster appears in the result.

Open the Brain project canvas.
Expected: the template deployment's PostgreSQL DB appears as a DB node after `/db` refresh.

- [ ] **Step 5: Commit final verification notes only if code changed during verification**

If verification required fixes, commit them:

```bash
git add apps/ui/src/lib/template-provider-db-labels.ts apps/ui/src/lib/template-provider-db-labels.test.ts apps/ui/src/lib/deploy-task/runner.ts
git commit -m "fix(template): finalize provider db label normalization"
```

If no files changed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan fixes new template deployments only, as requested. It does not include existing deployment backfill or DB discovery relaxation.
- Root cause coverage: The plan aligns template provider-created Cluster labels with `/db` discovery labels: `app.kubernetes.io/instance`, `clusterdefinition.kubeblocks.io/name`, `brain.io/managed-by=brain`, and `brain.io/project-id`.
- Scope control: No Go API changes, no template repo changes, no dependency changes.
- Type consistency: The normalization function accepts provider resource summaries compatible with `TemplateDeploymentResourceSummary` from `template-provider-core.ts`.
- Test coverage: Pure inference tests cover PostgreSQL 16.4, PostgreSQL 14.8, ApeCloud MySQL, Redis, MongoDB; fetch tests verify get + merge patch calls and non-cluster skip behavior.
