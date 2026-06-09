import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { applyRenderedTemplateDeployment } from "./template-k8s-apply";
import type { RenderedTemplateDeployment } from "./template-renderer";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_URL;
const APPLY_PATH_RE = /\/api\/k8s\/v1alpha1\/apply$/;
const INSTANCE_KIND_QUERY_RE = /kind=instances/;
const INSTANCE_NAME_QUERY_RE = /name=template-memos/;
const OWNER_REFERENCES_RE = /ownerReferences/;
const INSTANCE_UID_RE = /instance-uid/;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.API_URL;
  } else {
    process.env.API_URL = originalApiUrl;
  }
});

test("applyRenderedTemplateDeployment applies Instance, reads UID, then applies dependents", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{
    authorization?: string;
    body?: string;
    method?: string;
    url: string;
  }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
      authorization: (init?.headers as Record<string, string>)?.Authorization,
      body: typeof init?.body === "string" ? init.body : undefined,
      method: init?.method,
      url: String(url),
    });
    if (String(url).includes("/api/k8s/v1alpha1/get")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "app.sealos.io/v1",
            kind: "Instance",
            metadata: { name: "template-memos", uid: "instance-uid" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      );
    }
    return Promise.resolve(new Response("", { status: 200 }));
  }) as typeof fetch;

  const rendered: RenderedTemplateDeployment = {
    dependentYamls: [],
    instanceName: "template-memos",
    instanceYaml:
      "apiVersion: app.sealos.io/v1\nkind: Instance\nmetadata:\n  name: template-memos",
    resources: [
      {
        apiVersion: "app.sealos.io/v1",
        kind: "Instance",
        metadata: { name: "template-memos" },
      },
      {
        apiVersion: "apps/v1",
        kind: "StatefulSet",
        metadata: { name: "template-memos" },
      },
    ],
  };

  const result = await applyRenderedTemplateDeployment({
    encodedKubeconfig:
      "apiVersion: v1\nclusters:\n- cluster:\n    server: https://example.com",
    namespace: "ns-admin",
    rendered,
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.method, "POST");
  assert.equal(
    calls[0]?.authorization,
    "Bearer apiVersion%3A%20v1%0Aclusters%3A%0A-%20cluster%3A%0A%20%20%20%20server%3A%20https%3A%2F%2Fexample.com"
  );
  assert.equal(calls[1]?.authorization, calls[0]?.authorization);
  assert.equal(calls[2]?.authorization, calls[0]?.authorization);
  assert.match(calls[0]?.url ?? "", APPLY_PATH_RE);
  assert.match(calls[1]?.url ?? "", INSTANCE_KIND_QUERY_RE);
  assert.match(calls[1]?.url ?? "", INSTANCE_NAME_QUERY_RE);
  assert.match(calls[2]?.body ?? "", OWNER_REFERENCES_RE);
  assert.match(calls[2]?.body ?? "", INSTANCE_UID_RE);
  assert.deepEqual(result.resources, [
    {
      name: "template-memos",
      resourceType: "instance",
      uid: "instance-uid",
    },
    {
      name: "template-memos",
      resourceType: "statefulset",
      uid: "",
    },
  ]);
});
