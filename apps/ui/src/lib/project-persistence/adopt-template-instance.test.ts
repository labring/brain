import { mock } from "bun:test";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";

import {
  createDeployTaskTestHarness,
  type DeployTaskTestHarness,
} from "@/features/deploy/task/engine/testing/harness";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL,
  LAUNCHPAD_TEMPLATE_SOURCE_LABEL,
} from "@/lib/brain-labels";

import type { TemplateInstanceAdoptionFetch } from "./adopt-template-instance";
import type { ProjectPgDatabase } from "./db";
import { inspectProjectManagedResources } from "./delete-guard";
import { projects, templateInstanceAdoptions } from "./schema";

mock.module("server-only", () => ({}));

let harness: DeployTaskTestHarness;
let projectDb: ProjectPgDatabase | undefined;

mock.module(fileURLToPath(new URL("./db.ts", import.meta.url)), () => ({
  getProjectDb: () => {
    assert.ok(projectDb);
    return projectDb;
  },
}));

const {
  ADOPTION_WARNING,
  TEMPLATE_INSTANCE_ADOPTION_MAX_RESOURCES,
  TemplateInstanceAdoptionError,
  adoptTemplateInstance,
} = await import("./adopt-template-instance");
const { createProject } = await import("./projects");

before(async () => {
  harness = await createDeployTaskTestHarness();
  projectDb = harness.db as unknown as ProjectPgDatabase;
});

after(async () => {
  await harness.close();
});

interface ClusterObject {
  apiVersion: string;
  kind: string;
  labels: Record<string, string>;
  name: string;
  namespace: string;
  ownerReferences: Array<{ apiVersion: string; kind: string; uid: string }>;
  resourceKind: string;
  uid: string;
}

interface PatchRecord {
  body: { metadata?: { labels?: Record<string, string> } };
  kind: string;
  name: string;
  namespace: string;
  type: string | null;
}

interface MockCluster {
  failPatchOnce: Set<string>;
  objects: ClusterObject[];
  patches: PatchRecord[];
  unknownKinds: Set<string>;
}

function unstructured(object: ClusterObject) {
  return {
    apiVersion: object.apiVersion,
    kind: object.kind,
    metadata: {
      labels: { ...object.labels },
      name: object.name,
      namespace: object.namespace,
      ownerReferences: object.ownerReferences,
      uid: object.uid,
    },
  };
}

function matchesLabelSelector(
  labels: Record<string, string>,
  selector: string
): boolean {
  if (selector.trim() === "") {
    return true;
  }
  return selector.split(",").every((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) {
      return false;
    }
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    return labels[key] === value;
  });
}

function jsonResponse(body: unknown, status: number): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
      status,
    })
  );
}

function createClusterFetch(
  cluster: MockCluster
): TemplateInstanceAdoptionFetch {
  return (url, init) => {
    const parsed = new URL(String(url));
    const method = (init?.method ?? "GET").toUpperCase();
    const kind = parsed.searchParams.get("kind") ?? "";
    const name = parsed.searchParams.get("name") ?? "";
    const namespace = parsed.searchParams.get("namespace") ?? "";
    const selector = parsed.searchParams.get("label-selector") ?? "";

    if (
      parsed.pathname.includes("/api/ap/") ||
      parsed.pathname.includes("/api/db/")
    ) {
      return jsonResponse({ items: [] }, 200);
    }

    if (method === "PATCH" && parsed.pathname.includes("/patch")) {
      let body: PatchRecord["body"] = {};
      try {
        body = JSON.parse(String(init?.body ?? "{}")) as PatchRecord["body"];
      } catch {
        body = {};
      }
      cluster.patches.push({
        body,
        kind,
        name,
        namespace,
        type: parsed.searchParams.get("type"),
      });
      if (cluster.failPatchOnce.has(name)) {
        cluster.failPatchOnce.delete(name);
        return jsonResponse({ error: "patch failed" }, 500);
      }
      const target = cluster.objects.find(
        (object) =>
          object.resourceKind === kind &&
          object.name === name &&
          object.namespace === namespace
      );
      if (target == null) {
        return jsonResponse({ error: "not found" }, 404);
      }
      target.labels = { ...(body.metadata?.labels ?? {}) };
      return jsonResponse(unstructured(target), 200);
    }

    if (cluster.unknownKinds.has(kind)) {
      return jsonResponse({ error: `unknown resource "${kind}"` }, 500);
    }

    if (name !== "") {
      const object = cluster.objects.find(
        (entry) =>
          entry.resourceKind === kind &&
          entry.name === name &&
          (entry.namespace === namespace || namespace === "")
      );
      if (object == null) {
        return jsonResponse({ error: "not found" }, 404);
      }
      return jsonResponse(unstructured(object), 200);
    }

    const items = cluster.objects
      .filter(
        (object) =>
          object.resourceKind === kind &&
          (object.namespace === namespace || object.namespace === "") &&
          matchesLabelSelector(object.labels, selector)
      )
      .map(unstructured);
    return jsonResponse({ items }, 200);
  };
}

function sealosInstance(input: {
  labels?: Record<string, string>;
  name: string;
  namespace: string;
  uid: string;
}): ClusterObject {
  return {
    apiVersion: "app.sealos.io/v1",
    kind: "Instance",
    labels: {
      [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: input.name,
      ...input.labels,
    },
    name: input.name,
    namespace: input.namespace,
    ownerReferences: [],
    resourceKind: "instances",
    uid: input.uid,
  };
}

function namespacedChild(input: {
  apiVersion?: string;
  kind: string;
  labels?: Record<string, string>;
  name: string;
  namespace: string;
  ownerUid?: string;
  resourceKind: string;
  uid: string;
}): ClusterObject {
  return {
    apiVersion: input.apiVersion ?? "apps/v1",
    kind: input.kind,
    labels: {
      [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: input.name.split("-")[0] ?? input.name,
      ...input.labels,
    },
    name: input.name,
    namespace: input.namespace,
    ownerReferences:
      input.ownerUid == null
        ? []
        : [
            {
              apiVersion: "app.sealos.io/v1",
              kind: "Instance",
              uid: input.ownerUid,
            },
          ],
    resourceKind: input.resourceKind,
    uid: input.uid,
  };
}

async function projectRows(namespace: string) {
  assert.ok(projectDb);
  return await projectDb
    .select()
    .from(projects)
    .where(eq(projects.namespace, namespace));
}

function asAdoptionError(error: unknown): { message: string; status: number } {
  assert.equal(error instanceof TemplateInstanceAdoptionError, true);
  return error as { message: string; status: number };
}

async function mappingRows(namespace: string) {
  assert.ok(projectDb);
  return await projectDb
    .select()
    .from(templateInstanceAdoptions)
    .where(eq(templateInstanceAdoptions.namespace, namespace));
}

test("first adoption creates one Project and labels the Instance plus children", async () => {
  const namespace = "ns-first";
  const instanceName = "memos";
  const instanceUid = "uid-memos-1";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
      namespacedChild({
        kind: "Deployment",
        labels: {
          [LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL]: "memos",
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "memos-deploy",
        namespace,
        ownerUid: instanceUid,
        resourceKind: "deployments",
        uid: "uid-deploy-1",
      }),
      namespacedChild({
        apiVersion: "v1",
        kind: "Service",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "memos-svc",
        namespace,
        ownerUid: instanceUid,
        resourceKind: "services",
        uid: "uid-svc-1",
      }),
      namespacedChild({
        apiVersion: "autoscaling/v2",
        kind: "HorizontalPodAutoscaler",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "memos-hpa",
        namespace,
        ownerUid: instanceUid,
        resourceKind: "horizontalpodautoscalers",
        uid: "uid-hpa-1",
      }),
    ],
    patches: [],
    unknownKinds: new Set(["certificates"]),
  };

  const result = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch(cluster),
    instanceName,
    namespace,
    templateName: "memos",
  });

  assert.equal(result.adoption.status, "adopted");
  assert.equal(result.adoption.instanceName, instanceName);
  assert.equal(result.adoption.instanceUid, instanceUid);
  assert.equal(result.adoption.discoveredCount, 4);
  assert.equal(result.adoption.labeledCount, 4);
  assert.deepEqual(result.adoption.warnings, [
    ADOPTION_WARNING.podTemplateLabelsUnchanged,
  ]);
  assert.equal(result.project.namespace, namespace);
  assert.equal(result.project.displayName, "memos");

  const rows = await projectRows(namespace);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, result.project.id);

  assert.equal(cluster.patches.length, 4);
  for (const patch of cluster.patches) {
    assert.equal(patch.type, "merge");
    const labels = patch.body.metadata?.labels ?? {};
    assert.equal(labels[BRAIN_MANAGED_BY_LABEL], BRAIN_MANAGED_BY_VALUE);
    assert.equal(labels[BRAIN_PROJECT_ID_LABEL], result.project.id);
    assert.equal(labels[BRAIN_DEPLOYMENT_KIND_LABEL], "template");
    assert.equal(labels[BRAIN_DEPLOYMENT_NAME_LABEL], instanceName);
    assert.equal(labels[BRAIN_TEMPLATE_NAME_LABEL], "memos");
  }

  const deployPatch = cluster.patches.find(
    (patch) => patch.kind === "deployments"
  );
  assert.ok(deployPatch);
  const deployLabels = deployPatch.body.metadata?.labels ?? {};
  assert.equal(deployLabels[LAUNCHPAD_APP_DEPLOY_MANAGER_LABEL], "memos");
  assert.equal(deployLabels[LAUNCHPAD_TEMPLATE_SOURCE_LABEL], instanceName);

  const summary = await inspectProjectManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch({
      ...cluster,
      unknownKinds: new Set(),
    }),
    id: result.project.id,
    namespace,
  });
  assert.deepEqual(summary.template, [instanceName]);
  assert.deepEqual(summary.templateDeployments, ["memos-deploy"]);
});

test("repeat adoption of the same UID reuses the Project and does not duplicate it", async () => {
  const namespace = "ns-repeat";
  const instanceName = "wordpress";
  const instanceUid = "uid-wp-1";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
      namespacedChild({
        kind: "Deployment",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "wordpress-deploy",
        namespace,
        ownerUid: instanceUid,
        resourceKind: "deployments",
        uid: "uid-wp-deploy",
      }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const fetchImpl = createClusterFetch(cluster);

  const first = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
    templateName: "wordpress",
  });
  const second = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
    templateName: "wordpress",
  });

  assert.equal(second.project.id, first.project.id);
  assert.equal((await projectRows(namespace)).length, 1);
  assert.equal((await mappingRows(namespace)).length, 1);
  assert.equal(second.adoption.status, "adopted");
});

test("concurrent adoptions of the same UID converge on one Project", async () => {
  const namespace = "ns-concurrent";
  const instanceName = "ghost";
  const instanceUid = "uid-ghost-1";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const fetchImpl = createClusterFetch(cluster);
  const input = {
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
    templateName: "ghost",
  };

  const [left, right] = await Promise.all([
    adoptTemplateInstance(input),
    adoptTemplateInstance(input),
  ]);

  assert.equal(left.project.id, right.project.id);
  assert.equal((await projectRows(namespace)).length, 1);
  assert.equal((await mappingRows(namespace)).length, 1);
});

test("the same instance name with a new UID creates a new Project", async () => {
  const namespace = "ns-new-uid";
  const instanceName = "memos";
  const firstCluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: "uid-old" }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const first = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch(firstCluster),
    instanceName,
    namespace,
    templateName: "memos",
  });

  const secondCluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: "uid-new" }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const second = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch(secondCluster),
    instanceName,
    namespace,
    templateName: "memos",
  });

  assert.notEqual(second.project.id, first.project.id);
  assert.equal((await projectRows(namespace)).length, 2);
  assert.equal((await mappingRows(namespace)).length, 2);
  assert.equal(second.project.displayName, "memos-2");
});

test("missing Instance is 404 and does not create a Project", async () => {
  const namespace = "ns-missing";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [],
    patches: [],
    unknownKinds: new Set(),
  };

  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl: createClusterFetch(cluster),
        instanceName: "absent",
        namespace,
      }),
    (error) => {
      assert.equal(error instanceof TemplateInstanceAdoptionError, true);
      assert.equal(asAdoptionError(error).status, 404);
      assert.equal(
        asAdoptionError(error).message,
        "Template instance not found."
      );
      return true;
    }
  );
  assert.equal((await projectRows(namespace)).length, 0);
  assert.equal(cluster.patches.length, 0);
});

test("a non-Instance resource at kind=instances is 400", async () => {
  const namespace = "ns-wrong-kind";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        labels: {},
        name: "not-instance",
        namespace,
        ownerReferences: [],
        resourceKind: "instances",
        uid: "uid-wrong",
      },
    ],
    patches: [],
    unknownKinds: new Set(),
  };

  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl: createClusterFetch(cluster),
        instanceName: "not-instance",
        namespace,
      }),
    (error) => {
      assert.equal(error instanceof TemplateInstanceAdoptionError, true);
      assert.equal(asAdoptionError(error).status, 400);
      assert.equal(
        asAdoptionError(error).message,
        "Resource is not a Sealos Template Instance."
      );
      return true;
    }
  );
  assert.equal((await projectRows(namespace)).length, 0);
});

test("a foreign brain.io/project-id is 409 and leaves labels unchanged", async () => {
  const namespace = "ns-conflict";
  const instanceName = "n8n";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: "uid-n8n" }),
      namespacedChild({
        kind: "Deployment",
        labels: {
          [BRAIN_PROJECT_ID_LABEL]: "other-project",
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "n8n-deploy",
        namespace,
        ownerUid: "uid-n8n",
        resourceKind: "deployments",
        uid: "uid-n8n-deploy",
      }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const original = { ...cluster.objects[1]?.labels };

  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl: createClusterFetch(cluster),
        instanceName,
        namespace,
      }),
    (error) => {
      assert.equal(error instanceof TemplateInstanceAdoptionError, true);
      assert.equal(asAdoptionError(error).status, 409);
      return true;
    }
  );
  assert.equal((await projectRows(namespace)).length, 0);
  assert.equal(cluster.patches.length, 0);
  assert.deepEqual(cluster.objects[1]?.labels, original);
});

test("partial PATCH failure marks mapping failed and retry reuses the Project", async () => {
  const namespace = "ns-partial";
  const instanceName = "umami";
  const instanceUid = "uid-umami";
  const cluster: MockCluster = {
    failPatchOnce: new Set(["umami-deploy"]),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
      namespacedChild({
        kind: "Deployment",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: "umami-deploy",
        namespace,
        ownerUid: instanceUid,
        resourceKind: "deployments",
        uid: "uid-umami-deploy",
      }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const fetchImpl = createClusterFetch(cluster);

  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl,
        instanceName,
        namespace,
        templateName: "umami",
      }),
    (error) => {
      assert.equal(error instanceof TemplateInstanceAdoptionError, true);
      assert.equal(asAdoptionError(error).status, 502);
      assert.equal(
        asAdoptionError(error).message,
        "Failed to label template instance resources."
      );
      return true;
    }
  );

  const failedMappings = await mappingRows(namespace);
  assert.equal(failedMappings.length, 1);
  assert.equal(failedMappings[0]?.status, "failed");
  const projectId = failedMappings[0]?.projectId;
  assert.ok(projectId);
  assert.equal((await projectRows(namespace)).length, 1);

  const retry = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
    templateName: "umami",
  });
  assert.equal(retry.project.id, projectId);
  assert.equal(retry.adoption.status, "adopted");
  assert.equal((await projectRows(namespace)).length, 1);
  const adopted = await mappingRows(namespace);
  assert.equal(adopted[0]?.status, "adopted");
});

test("more than 500 discovered resources is rejected before any mutation", async () => {
  const namespace = "ns-limit";
  const instanceName = "huge";
  const instanceUid = "uid-huge";
  const children = Array.from(
    { length: TEMPLATE_INSTANCE_ADOPTION_MAX_RESOURCES },
    (_, index) =>
      namespacedChild({
        kind: "ConfigMap",
        apiVersion: "v1",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: instanceName,
        },
        name: `huge-cm-${index}`,
        namespace,
        ownerUid: instanceUid,
        resourceKind: "configmaps",
        uid: `uid-cm-${index}`,
      })
  );
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
      ...children,
    ],
    patches: [],
    unknownKinds: new Set(),
  };

  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl: createClusterFetch(cluster),
        instanceName,
        namespace,
      }),
    (error) => {
      assert.equal(error instanceof TemplateInstanceAdoptionError, true);
      assert.equal(asAdoptionError(error).status, 400);
      assert.equal(
        asAdoptionError(error).message,
        "Template instance has too many resources to adopt."
      );
      return true;
    }
  );
  assert.equal((await projectRows(namespace)).length, 0);
  assert.equal((await mappingRows(namespace)).length, 0);
  assert.equal(cluster.patches.length, 0);
});

test("resources already labeled for this Project are adopted idempotently", async () => {
  const namespace = "ns-already";
  const instanceName = "already";
  const instanceUid = "uid-already";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: instanceName, namespace, uid: instanceUid }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const fetchImpl = createClusterFetch(cluster);
  const first = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
  });
  cluster.patches.length = 0;
  const second = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    instanceName,
    namespace,
  });
  assert.equal(second.project.id, first.project.id);
  assert.equal(second.adoption.status, "adopted");
  const labels = cluster.patches[0]?.body.metadata?.labels ?? {};
  assert.equal(labels[BRAIN_PROJECT_ID_LABEL], first.project.id);
});

test("explicit displayName collisions are 409 and derived names follow ADR 0058", async () => {
  const namespace = "ns-names";
  await createProject({
    displayName: "Taken",
    namespace,
  });

  const collideCluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: "taken-inst", namespace, uid: "uid-taken" }),
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  await assert.rejects(
    () =>
      adoptTemplateInstance({
        apiBaseUrl: "https://brain.test",
        displayName: "Taken",
        encodedKubeconfig: "kubeconfig",
        fetchImpl: createClusterFetch(collideCluster),
        instanceName: "taken-inst",
        namespace,
      }),
    (error) => {
      assert.equal(
        error instanceof Error && error.name === "ProjectPersistenceError",
        true
      );
      return true;
    }
  );
  assert.equal(collideCluster.patches.length, 0);

  const derivedCluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [sealosInstance({ name: "blog-xyz", namespace, uid: "uid-blog" })],
    patches: [],
    unknownKinds: new Set(),
  };
  const derived = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch(derivedCluster),
    instanceName: "blog-xyz",
    namespace,
    templateName: "blog",
  });
  assert.equal(derived.project.displayName, "blog");
});

test("only the Instance still succeeds with incompleteResourceSet", async () => {
  const namespace = "ns-incomplete";
  const cluster: MockCluster = {
    failPatchOnce: new Set(),
    objects: [
      sealosInstance({ name: "solo", namespace, uid: "uid-solo" }),
      {
        apiVersion: "cert-manager.io/v1",
        kind: "ClusterIssuer",
        labels: {
          [LAUNCHPAD_TEMPLATE_SOURCE_LABEL]: "solo",
        },
        name: "solo-issuer",
        namespace: "",
        ownerReferences: [],
        resourceKind: "issuers",
        uid: "uid-issuer",
      },
    ],
    patches: [],
    unknownKinds: new Set(),
  };
  const result = await adoptTemplateInstance({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: createClusterFetch(cluster),
    instanceName: "solo",
    namespace,
  });
  assert.equal(result.adoption.discoveredCount, 1);
  assert.equal(result.adoption.labeledCount, 1);
  assert.ok(
    result.adoption.warnings.includes(ADOPTION_WARNING.incompleteResourceSet)
  );
  assert.ok(
    result.adoption.warnings.includes(ADOPTION_WARNING.clusterScopedSkipped)
  );
});

test("missing API_URL fails closed without mutating", async () => {
  const previous = process.env.API_URL;
  delete process.env.API_URL;
  try {
    await assert.rejects(
      () =>
        adoptTemplateInstance({
          encodedKubeconfig: "kubeconfig",
          fetchImpl: () => jsonResponse({ items: [] }, 200),
          instanceName: "x",
          namespace: "ns-no-api",
        }),
      (error) => {
        assert.equal(error instanceof TemplateInstanceAdoptionError, true);
        assert.equal(asAdoptionError(error).status, 502);
        assert.equal(
          asAdoptionError(error).message,
          "API_URL is required to adopt template instance resources."
        );
        return true;
      }
    );
  } finally {
    if (previous === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = previous;
    }
  }
});
