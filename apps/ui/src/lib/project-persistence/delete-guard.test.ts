import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertProjectHasNoManagedResources,
  deleteProjectManagedResources,
  ProjectDeleteBlockedError,
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
  return [{ metadata: { name: "data-template-memos-0" } }];
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
  const fetchImpl: typeof fetch = (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    return new Response(
      JSON.stringify({ items: managedResourceItems(parsed) }),
      {
        status: 200,
      }
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
        templatePersistentVolumeClaims: ["data-template-memos-0"],
      });
      return true;
    }
  );

  assert.equal(calls.length, 4);
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
  const fetchImpl: typeof fetch = () =>
    new Response(JSON.stringify({ items: [] }), { status: 200 });

  await assertProjectHasNoManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });
});

test("project delete guard does not double encode kubeconfig authorization", async () => {
  const calls: string[] = [];
  const encodedKubeconfig = encodeURIComponent(
    "apiVersion: v1\nkind: Config\n"
  );
  const fetchImpl: typeof fetch = (_url, init) => {
    const headers = new Headers(init?.headers);
    calls.push(headers.get("Authorization") ?? "");
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };

  await assertProjectHasNoManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig,
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });

  assert.equal(calls.length, 4);
  for (const authorization of calls) {
    assert.equal(authorization, `Bearer ${encodedKubeconfig}`);
  }
});

test("project delete guard requires an API base URL", async () => {
  await assert.rejects(
    () =>
      assertProjectHasNoManagedResources({
        encodedKubeconfig: "kubeconfig",
        fetchImpl: () =>
          new Response(JSON.stringify({ items: [] }), { status: 200 }),
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
});

test("project delete guard surfaces downstream cleanup errors", async () => {
  const fetchImpl: typeof fetch = (url) => {
    const parsed = new URL(String(url));
    if (parsed.searchParams.get("kind") === "persistentvolumeclaims") {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
      });
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
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

test("project managed resource cleanup deletes direct DBs, direct APs, template PVCs, then template Instances", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const parsed = new URL(String(url));
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ status: "deleted" }), {
        status: 200,
      });
    }
    return new Response(
      JSON.stringify({ items: managedResourceItems(parsed) }),
      {
        status: 200,
      }
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
    templatePersistentVolumeClaims: ["data-template-memos-0"],
  });
  assert.equal(calls.length, 8);
  assert.equal(
    calls[4],
    "DELETE https://brain.test/api/db/v1alpha1?name=postgres&namespace=ns-a"
  );
  assert.equal(
    calls[5],
    "DELETE https://brain.test/api/ap/v1alpha1?name=api&namespace=ns-a"
  );
  assert.equal(
    calls[6],
    "DELETE https://brain.test/api/k8s/v1alpha1/delete?kind=persistentvolumeclaims&label-selector=brain.io%2Fproject-id%3Dproject-a%2Cbrain.io%2Fdeployment-kind%3Dtemplate&namespace=ns-a"
  );
  assert.equal(
    calls[7],
    "DELETE https://brain.test/api/k8s/v1alpha1/delete?kind=instances&name=template-memos&namespace=ns-a"
  );
});

test("project managed resource cleanup tolerates already-deleted children", async () => {
  const fetchImpl: typeof fetch = (url, init) => {
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      });
    }
    return new Response(
      JSON.stringify({ items: apDbResourceItems(new URL(String(url))) }),
      { status: 200 }
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
