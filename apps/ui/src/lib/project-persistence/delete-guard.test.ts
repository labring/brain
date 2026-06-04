import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertProjectHasNoManagedResources,
  deleteProjectManagedResources,
  ProjectDeleteBlockedError,
} from "./delete-guard";

test("project delete guard blocks deletion when AP or DB resources still exist", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (url) => {
    calls.push(String(url));
    const pathname = new URL(String(url)).pathname;
    const items = pathname.includes("/api/ap/")
      ? [{ metadata: { name: "api" } }]
      : [{ metadata: { name: "postgres" } }];
    return new Response(JSON.stringify({ items }), { status: 200 });
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
      });
      return true;
    }
  );

  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call);
    assert.equal(url.searchParams.get("namespace"), "ns-a");
    assert.equal(
      url.searchParams.get("label-selector"),
      "brain.io/project-id=project-a"
    );
  }
});

test("project delete guard allows deletion when no AP or DB resources exist", async () => {
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

test("project managed resource cleanup deletes DBs before APs", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const pathname = new URL(String(url)).pathname;
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ status: "deleted" }), {
        status: 200,
      });
    }
    const items = pathname.includes("/api/ap/")
      ? [{ metadata: { name: "api" } }]
      : [{ metadata: { name: "postgres" } }];
    return new Response(JSON.stringify({ items }), { status: 200 });
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
  });
  assert.equal(calls.length, 4);
  assert.equal(
    calls[2],
    "DELETE https://brain.test/api/db/v1alpha1?name=postgres&namespace=ns-a"
  );
  assert.equal(
    calls[3],
    "DELETE https://brain.test/api/ap/v1alpha1?name=api&namespace=ns-a"
  );
});

test("project managed resource cleanup tolerates already-deleted children", async () => {
  const fetchImpl: typeof fetch = (url, init) => {
    if (init?.method === "DELETE") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      });
    }
    const pathname = new URL(String(url)).pathname;
    const items = pathname.includes("/api/ap/")
      ? [{ metadata: { name: "api" } }]
      : [{ metadata: { name: "postgres" } }];
    return new Response(JSON.stringify({ items }), { status: 200 });
  };

  await deleteProjectManagedResources({
    apiBaseUrl: "https://brain.test",
    encodedKubeconfig: "kubeconfig",
    fetchImpl,
    id: "project-a",
    namespace: "ns-a",
  });
});
