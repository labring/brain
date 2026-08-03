import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertProjectHasNoManagedResources,
  deleteProjectManagedResources,
  inspectProjectManagedResources,
  ProjectDeleteBlockedError,
  type ProjectDeleteFetch,
  ProjectManagedResourceCleanupError,
} from "./delete-guard";

function managedResourceItems(url: URL) {
  const pathname = url.pathname;
  const kind = url.searchParams.get("kind");
  if (pathname.includes("/api/ap/")) {
    return [{ metadata: { name: "api" } }];
  }
  if (pathname.includes("/api/db/")) {
    return [{ metadata: { name: "postgres" } }];
  }
  if (kind === "instances") {
    return [{ metadata: { name: "template-memos" } }];
  }
  const names: Record<string, string> = {
    certificates: "template-memos-cert",
    clusters: "template-memos-cluster",
    configmaps: "template-memos-config",
    deployments: "template-memos-deploy",
    ingresses: "template-memos-ingress",
    issuers: "template-memos-issuer",
    jobs: "template-memos-job",
    opsrequests: "template-memos-ops",
    persistentvolumeclaims: "data-template-memos-0",
    pods: "template-memos-pod",
    secrets: "template-memos-secret",
    services: "template-memos-service",
    statefulsets: "template-memos-sts",
  };
  return [{ metadata: { name: names[kind ?? ""] ?? "template-memos-child" } }];
}

function apDbResourceItems(url: URL) {
  if (url.pathname.includes("/api/ap/")) {
    return [{ metadata: { name: "api" } }];
  }
  if (url.pathname.includes("/api/db/")) {
    return [{ metadata: { name: "postgres" } }];
  }
  return [];
}

test("project delete guard blocks deletion when managed resources still exist", async () => {
  const calls: string[] = [];
  const fetchImpl: ProjectDeleteFetch = (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    return Promise.resolve(
      new Response(JSON.stringify({ items: managedResourceItems(parsed) }), {
        status: 200,
      })
    );
  };

  await assert.rejects(
    () =>
      assertProjectHasNoManagedResources({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl,
        id: "project-a",
        namespace: "ns-a",
      }),
    (error) => {
      assert.equal(error instanceof ProjectDeleteBlockedError, true);
      assert.deepEqual((error as ProjectDeleteBlockedError).resources, {
        ap: ["api"],
        db: ["postgres"],
        template: ["template-memos"],
        templateCertificates: ["template-memos-cert"],
        templateClusters: ["template-memos-cluster"],
        templateConfigMaps: ["template-memos-config"],
        templateDeployments: ["template-memos-deploy"],
        templateIngresses: ["template-memos-ingress"],
        templateIssuers: ["template-memos-issuer"],
        templateJobs: ["template-memos-job"],
        templateOpsRequests: ["template-memos-ops"],
        templatePods: ["template-memos-pod"],
        templatePersistentVolumeClaims: ["data-template-memos-0"],
        templateSecrets: ["template-memos-secret"],
        templateServices: ["template-memos-service"],
        templateStatefulSets: ["template-memos-sts"],
      });
      return true;
    }
  );

  assert.equal(calls.length, 16);
  for (const call of calls) {
    const url = new URL(call);
    assert.equal(url.searchParams.get("namespace"), "ns-a");
    if (url.searchParams.get("kind") === null) {
      const selector = url.searchParams.get("label-selector");
      assert.ok(
        selector ===
          "brain.io/project-id=project-a,brain.io/deployment-kind=ap" ||
          selector ===
            "brain.io/project-id=project-a,brain.io/deployment-kind=db"
      );
    } else {
      assert.equal(
        url.searchParams.get("label-selector"),
        "brain.io/project-id=project-a,brain.io/deployment-kind=template"
      );
    }
  }
});

test("project delete guard allows deletion when no managed resources exist", async () => {
  const fetchImpl: ProjectDeleteFetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    );

  await assertProjectHasNoManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });
});

test("project deletion inspection returns the complete scope without deleting", async () => {
  const calls: string[] = [];
  const summary = await inspectProjectManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl: (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      return Promise.resolve(
        new Response(
          JSON.stringify({ items: managedResourceItems(new URL(String(url))) }),
          { status: 200 }
        )
      );
    },
    id: "project-a",
    namespace: "ns-a",
  });

  assert.equal(calls.length, 16);
  assert.ok(calls.every((call) => call.startsWith("GET ")));
  assert.deepEqual(summary.ap, ["api"]);
  assert.deepEqual(summary.db, ["postgres"]);
  assert.deepEqual(summary.template, ["template-memos"]);
});

test("project delete guard does not double encode kubeconfig authorization", async () => {
  const calls: string[] = [];
  const encodedKubeconfig = encodeURIComponent(
    "apiVersion: v1\nkind: Config\n"
  );
  const fetchImpl: ProjectDeleteFetch = (_url, init) => {
    const headers = new Headers(init?.headers);
    calls.push(headers.get("Authorization") ?? "");
    return Promise.resolve(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    );
  };

  await assertProjectHasNoManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig,
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });

  assert.equal(calls.length, 16);
  for (const authorization of calls) {
    assert.equal(authorization, `Bearer ${encodedKubeconfig}`);
  }
});

test("project delete guard requires an API base URL", async () => {
  const previousApiUrl = process.env.API_URL;
  delete process.env.API_URL;
  try {
    await assert.rejects(
      () =>
        assertProjectHasNoManagedResources({
          encodedKubeconfig: "kubeconfig",
          fetchImpl: () =>
            Promise.resolve(
              new Response(JSON.stringify({ items: [] }), { status: 200 })
            ),
          id: "project-a",
          namespace: "ns-a",
        }),
      (error) => {
        assert.equal(error instanceof ProjectManagedResourceCleanupError, true);
        assert.equal(
          (error as ProjectManagedResourceCleanupError).message,
          "API_URL is required to clean up project resources."
        );
        return true;
      }
    );
  } finally {
    if (previousApiUrl === undefined) {
      delete process.env.API_URL;
    } else {
      process.env.API_URL = previousApiUrl;
    }
  }
});

test("project delete guard surfaces downstream cleanup errors", async () => {
  const fetchImpl: ProjectDeleteFetch = (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("kind") === "persistentvolumeclaims") {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "forbidden" }), {
          status: 403,
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ items: [] }), { status: 200 })
    );
  };

  await assert.rejects(
    () =>
      deleteProjectManagedResources({
        apiBaseUrl: "https://brain.test",
        encodedKubeconfig: "kubeconfig",
        fetchImpl,
        id: "project-a",
        namespace: "ns-a",
      }),
    (error) => {
      assert.equal(error instanceof ProjectManagedResourceCleanupError, true);
      assert.equal((error as ProjectManagedResourceCleanupError).status, 403);
      assert.equal(
        (error as ProjectManagedResourceCleanupError).message,
        "Failed to inspect project resources (403): forbidden"
      );
      return true;
    }
  );
});

test("project managed resource cleanup deletes direct resources, template Instances, then labeled template children", async () => {
  const calls: string[] = [];
  const fetchImpl: ProjectDeleteFetch = (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const parsed = new URL(String(url));
    if (init?.method === "DELETE") {
      return Promise.resolve(
        new Response(JSON.stringify({ status: "deleted" }), {
          status: 200,
        })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ items: managedResourceItems(parsed) }), {
        status: 200,
      })
    );
  };

  const deleted = await deleteProjectManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });

  assert.deepEqual(deleted, {
    ap: ["api"],
    db: ["postgres"],
    template: ["template-memos"],
    templateCertificates: ["template-memos-cert"],
    templateClusters: ["template-memos-cluster"],
    templateConfigMaps: ["template-memos-config"],
    templateDeployments: ["template-memos-deploy"],
    templateIngresses: ["template-memos-ingress"],
    templateIssuers: ["template-memos-issuer"],
    templateJobs: ["template-memos-job"],
    templateOpsRequests: ["template-memos-ops"],
    templatePods: ["template-memos-pod"],
    templatePersistentVolumeClaims: ["data-template-memos-0"],
    templateSecrets: ["template-memos-secret"],
    templateServices: ["template-memos-service"],
    templateStatefulSets: ["template-memos-sts"],
  });
  assert.equal(calls.length, 32);
  assert.equal(
    calls[16],
    "DELETE https://brain.test/api/db/v1alpha1?name=postgres&namespace=ns-a"
  );
  assert.equal(
    calls[17],
    "DELETE https://brain.test/api/ap/v1alpha1?name=api&namespace=ns-a"
  );
  assert.equal(
    calls[18],
    "DELETE https://brain.test/api/k8s/v1alpha1/delete?kind=instances&name=template-memos&namespace=ns-a"
  );
  assert.equal(
    calls[19],
    "DELETE https://brain.test/api/k8s/v1alpha1/delete?kind=certificates&label-selector=brain.io%2Fproject-id%3Dproject-a%2Cbrain.io%2Fdeployment-kind%3Dtemplate&namespace=ns-a"
  );
  assert.equal(
    calls[31],
    "DELETE https://brain.test/api/k8s/v1alpha1/delete?kind=secrets&label-selector=brain.io%2Fproject-id%3Dproject-a%2Cbrain.io%2Fdeployment-kind%3Dtemplate&namespace=ns-a"
  );
});

test("project managed resource cleanup tolerates already-deleted children", async () => {
  const fetchImpl: ProjectDeleteFetch = (url, init) => {
    if (init?.method === "DELETE") {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
        })
      );
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ items: apDbResourceItems(new URL(String(url))) }),
        { status: 200 }
      )
    );
  };

  await deleteProjectManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });
});
