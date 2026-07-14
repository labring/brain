import assert from "node:assert/strict";
import { test } from "node:test";
import { API_ROUTES } from "@workspace/api/constants";

import {
  buildProductResourceDraft,
  buildProductResourceRequest,
  createChatProductTools,
  draftProductResourceChangeInput,
  executeConfirmedProductWrite,
  normalizeProductPatch,
} from "./chat-product-tools";

test("product read requests use Brain AP and DB product API routes", () => {
  assert.deepEqual(
    buildProductResourceRequest({
      kind: "AP",
      kubeconfig: "kc",
      name: "web",
      namespace: "ns",
      operation: "read",
    }),
    {
      base: "",
      header: { Authorization: "Bearer kc" },
      method: "GET",
      path: API_ROUTES.ap.root,
      query: { name: "web", namespace: "ns" },
    }
  );

  assert.equal(
    buildProductResourceRequest({
      kind: "DB",
      kubeconfig: "kc",
      namespace: "ns",
      operation: "read",
    }).path,
    API_ROUTES.db.root
  );
});

test("product draft returns a preview and never calls the fetcher", () => {
  const draft = buildProductResourceDraft({
    kind: "AP",
    name: "web",
    namespace: "ns",
    patch: { spec: { replicas: 2 } },
  });

  assert.deepEqual(draft, {
    action: "patch",
    body: { spec: { replicas: 2 } },
    kind: "AP",
    name: "web",
    namespace: "ns",
  });
});

test("AP product draft normalizes top-level product fields under spec", () => {
  const draft = buildProductResourceDraft({
    kind: "AP",
    name: "web",
    namespace: "ns",
    patch: {
      resource: {
        replicas: 2,
        replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
      },
    },
  });

  assert.deepEqual(draft, {
    action: "patch",
    body: {
      spec: {
        resource: {
          replicas: 2,
          replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
        },
      },
    },
    kind: "AP",
    name: "web",
    namespace: "ns",
  });
});

test("AP product patch normalization preserves metadata and existing spec", () => {
  assert.deepEqual(
    normalizeProductPatch("AP", {
      metadata: { labels: { region: "apps.example.com" } },
      resource: { replicas: 2 },
    }),
    {
      metadata: { labels: { region: "apps.example.com" } },
      spec: { resource: { replicas: 2 } },
    }
  );
  assert.deepEqual(
    normalizeProductPatch("AP", { spec: { resource: { replicas: 3 } } }),
    { spec: { resource: { replicas: 3 } } }
  );
});

test("DB product patch normalization is a no-op", () => {
  const patch = { resource: { replicas: 2 } };

  assert.equal(normalizeProductPatch("DB", patch), patch);
});

test("product draft schema stays a top-level object for OpenAI function parameters", () => {
  const shape = (
    draftProductResourceChangeInput as { _def?: { type?: string } }
  )._def;

  assert.equal(shape?.type, "object");
});

test("product write tool requires AI SDK approval before execution", () => {
  const tools = createChatProductTools({
    kubeconfig: "kc",
    kubernetesNamespace: "ns",
  });

  assert.equal(Reflect.get(tools.writeProductResource, "needsApproval"), true);
});

test("confirmed product write refuses to call Brain API until confirmed true", async () => {
  let calls = 0;

  const result = await executeConfirmedProductWrite(
    {
      confirmed: false,
      kind: "AP",
      kubeconfig: "kc",
      name: "web",
      namespace: "ns",
      operation: "patch",
      patch: { spec: { replicas: 2 } },
    },
    () => {
      calls += 1;
      return Promise.resolve({ ok: true });
    }
  );

  assert.deepEqual(result, {
    error: "Refused to write AP ns/web: confirmed must be true.",
    ok: false,
  });
  assert.equal(calls, 0);
});

test("confirmed product write calls Brain product API with PATCH", async () => {
  const requests: unknown[] = [];

  const result = await executeConfirmedProductWrite(
    {
      confirmed: true,
      kind: "DB",
      kubeconfig: "kc",
      name: "postgres",
      namespace: "ns",
      operation: "patch",
      patch: { spec: { cpu: "1" } },
    },
    (request) => {
      requests.push(request);
      return Promise.resolve({ status: "ok" });
    }
  );

  assert.deepEqual(result, { data: { status: "ok" }, ok: true });
  assert.deepEqual(requests, [
    {
      base: "",
      body: { spec: { cpu: "1" } },
      header: { Authorization: "Bearer kc" },
      method: "PATCH",
      path: API_ROUTES.db.root,
      query: { name: "postgres", namespace: "ns" },
    },
  ]);
});

test("confirmed AP product write normalizes top-level resource patch before PATCH", async () => {
  const requests: unknown[] = [];

  const result = await executeConfirmedProductWrite(
    {
      confirmed: true,
      kind: "AP",
      kubeconfig: "kc",
      name: "web",
      namespace: "ns",
      operation: "patch",
      patch: {
        resource: {
          replicas: 2,
          replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
        },
      },
    },
    (request) => {
      requests.push(request);
      return Promise.resolve({ status: "ok" });
    }
  );

  assert.deepEqual(result, { data: { status: "ok" }, ok: true });
  assert.deepEqual(requests, [
    {
      base: "",
      body: {
        spec: {
          resource: {
            replicas: 2,
            replicaStrategy: { fixed: { replicas: 2 }, type: "fixed" },
          },
        },
      },
      header: { Authorization: "Bearer kc" },
      method: "PATCH",
      path: API_ROUTES.ap.root,
      query: { name: "web", namespace: "ns" },
    },
  ]);
});

test("confirmed product write rejects competing manifest and patch bodies", async () => {
  let calls = 0;

  const result = await executeConfirmedProductWrite(
    {
      confirmed: true,
      kind: "AP",
      kubeconfig: "kc",
      manifest: { kind: "AP" },
      name: "web",
      namespace: "ns",
      operation: "patch",
      patch: { spec: { replicas: 2 } },
    },
    () => {
      calls += 1;
      return Promise.resolve({ ok: true });
    }
  );

  assert.deepEqual(result, {
    error: "Provide either manifest or patch, not both.",
    ok: false,
  });
  assert.equal(calls, 0);
});

test("confirmed product create wraps direct manifest in yaml body for Brain product API", async () => {
  const requests: unknown[] = [];

  const result = await executeConfirmedProductWrite(
    {
      confirmed: true,
      kind: "AP",
      kubeconfig: "kc",
      manifest: {
        apiVersion: "brain.io/direct",
        kind: "AP",
        metadata: { name: "web", namespace: "ns" },
        spec: { projectId: "project-1" },
      },
      name: "web",
      namespace: "ns",
      operation: "create",
    },
    (request) => {
      requests.push(request);
      return Promise.resolve({ status: "ok" });
    }
  );

  assert.deepEqual(result, { data: { status: "ok" }, ok: true });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    base: "",
    body: {
      yaml: [
        "apiVersion: brain.io/direct",
        "kind: AP",
        "metadata:",
        "  name: web",
        "  namespace: ns",
        "spec:",
        "  projectId: project-1",
      ].join("\n"),
    },
    header: { Authorization: "Bearer kc" },
    method: "PUT",
    path: API_ROUTES.ap.root,
  });
});
