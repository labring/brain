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
const PROJECT_LABEL_RE = /brain\.io\/project-id: project-uid/;
const TEMPLATE_NAME_LABEL_RE = /brain\.io\/template-name: memos/;
const WRONG_PROJECT_LABEL_RE = /wrong-project/;
const WRONG_TEMPLATE_LABEL_RE = /wrong-template/;
const GHCR_PULL_SECRET_RE = /template-memos-ghcr-pull/;
const LONG_GHCR_PULL_SECRET_RE =
  /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-ghcr-pull/;
const DOCKER_CONFIG_JSON_RE = /\.dockerconfigjson/;
const GHCR_DOCKER_CONFIG_RE =
  /eyJhdXRocyI6eyJnaGNyLmlvIjp7ImF1dGgiOiJlQzFoWTJObGMzTXRkRzlyWlc0NloyaHdYM1JsYzNSZmRHOXJaVzQ9In19fQ==/;
const EXISTING_PULL_SECRET_RE = /existing-pull-secret/;
const GHCR_BUILD_MATCH_RE =
  /every GHCR workload image matches the build result/;

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
        metadata: {
          labels: { "brain.io/project-id": "wrong-project" },
          name: "template-memos",
        },
        spec: {
          template: {
            metadata: {
              labels: { "brain.io/template-name": "wrong-template" },
            },
            spec: { containers: [{ image: "docker.io/library/nginx" }] },
          },
          volumeClaimTemplates: [
            {
              metadata: {
                labels: { "brain.io/project-id": "wrong-project" },
                name: "data",
              },
            },
          ],
        },
      },
    ],
  };

  const result = await applyRenderedTemplateDeployment({
    encodedKubeconfig:
      "apiVersion: v1\nclusters:\n- cluster:\n    server: https://example.com",
    namespace: "ns-admin",
    projectId: "project-uid",
    rendered,
    templateName: "memos",
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
  assert.match(calls[0]?.body ?? "", PROJECT_LABEL_RE);
  assert.match(calls[0]?.body ?? "", TEMPLATE_NAME_LABEL_RE);
  assert.match(calls[2]?.body ?? "", OWNER_REFERENCES_RE);
  assert.match(calls[2]?.body ?? "", INSTANCE_UID_RE);
  assert.match(calls[2]?.body ?? "", PROJECT_LABEL_RE);
  assert.match(calls[2]?.body ?? "", TEMPLATE_NAME_LABEL_RE);
  assert.doesNotMatch(calls[2]?.body ?? "", WRONG_PROJECT_LABEL_RE);
  assert.doesNotMatch(calls[2]?.body ?? "", WRONG_TEMPLATE_LABEL_RE);
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

test("applyRenderedTemplateDeployment injects GHCR pull secret only into apply payload", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{
    body?: string;
    method?: string;
    url: string;
  }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
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
        kind: "Deployment",
        metadata: { name: "template-memos" },
        spec: {
          selector: { matchLabels: { app: "template-memos" } },
          template: {
            metadata: { labels: { app: "template-memos" } },
            spec: {
              containers: [
                {
                  image: "ghcr.io/zjy365/seakills-site@sha256:abc123",
                  name: "web",
                },
              ],
              imagePullSecrets: [{ name: "existing-pull-secret" }],
            },
          },
        },
      },
    ],
  };

  assert.doesNotMatch(JSON.stringify(rendered), DOCKER_CONFIG_JSON_RE);
  assert.doesNotMatch(JSON.stringify(rendered), GHCR_PULL_SECRET_RE);

  await applyRenderedTemplateDeployment({
    encodedKubeconfig: "kubeconfig",
    namespace: "ns-admin",
    projectId: "project-uid",
    registryAuth: {
      buildDigest: "sha256:abc123",
      buildImage: "ghcr.io/zjy365/seakills-site@sha256:abc123",
      githubToken: "ghp_test_token",
    },
    rendered,
    templateName: "memos",
  });

  assert.equal(calls.length, 3);
  assert.doesNotMatch(calls[0]?.body ?? "", DOCKER_CONFIG_JSON_RE);
  assert.match(calls[2]?.body ?? "", DOCKER_CONFIG_JSON_RE);
  assert.match(calls[2]?.body ?? "", GHCR_PULL_SECRET_RE);
  assert.match(calls[2]?.body ?? "", GHCR_DOCKER_CONFIG_RE);
  assert.match(calls[2]?.body ?? "", EXISTING_PULL_SECRET_RE);
  assert.ok(
    (calls[2]?.body ?? "").indexOf("kind: Secret") <
      (calls[2]?.body ?? "").indexOf("kind: Deployment")
  );
});

test("applyRenderedTemplateDeployment keeps generated GHCR pull secret name within Kubernetes limits", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{ body?: string; url: string }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
      url: String(url),
    });
    if (String(url).includes("/api/k8s/v1alpha1/get")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            apiVersion: "app.sealos.io/v1",
            kind: "Instance",
            metadata: { name: "a".repeat(63), uid: "instance-uid" },
          }),
          { headers: { "Content-Type": "application/json" }, status: 200 }
        )
      );
    }
    return Promise.resolve(new Response("", { status: 200 }));
  }) as typeof fetch;

  const instanceName = "a".repeat(63);
  await applyRenderedTemplateDeployment({
    encodedKubeconfig: "kubeconfig",
    namespace: "ns-admin",
    projectId: "project-uid",
    registryAuth: {
      buildDigest: "sha256:abc123",
      buildImage: "ghcr.io/zjy365/seakills-site@sha256:abc123",
      githubToken: "ghp_test_token",
    },
    rendered: {
      dependentYamls: [],
      instanceName,
      instanceYaml: `apiVersion: app.sealos.io/v1\nkind: Instance\nmetadata:\n  name: ${instanceName}`,
      resources: [
        {
          apiVersion: "app.sealos.io/v1",
          kind: "Instance",
          metadata: { name: instanceName },
        },
        {
          apiVersion: "apps/v1",
          kind: "StatefulSet",
          metadata: { name: instanceName },
          spec: {
            template: {
              spec: {
                containers: [
                  {
                    image: "ghcr.io/zjy365/seakills-site@sha256:abc123",
                    name: "web",
                  },
                ],
              },
            },
          },
        },
      ],
    },
    templateName: "memos",
  });

  assert.match(calls[2]?.body ?? "", LONG_GHCR_PULL_SECRET_RE);
});

test("applyRenderedTemplateDeployment rejects mixed build and unrelated GHCR workload images", async () => {
  process.env.API_URL = "https://api.example.com";
  const calls: Array<{ body?: string; url: string }> = [];
  globalThis.fetch = ((url, init) => {
    calls.push({
      body: typeof init?.body === "string" ? init.body : undefined,
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

  await assert.rejects(
    applyRenderedTemplateDeployment({
      encodedKubeconfig: "kubeconfig",
      namespace: "ns-admin",
      projectId: "project-uid",
      registryAuth: {
        buildDigest: "sha256:abc123",
        buildImage: "ghcr.io/zjy365/seakills-site@sha256:abc123",
        githubToken: "ghp_test_token",
      },
      rendered: {
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
            kind: "Deployment",
            metadata: { name: "template-memos" },
            spec: {
              template: {
                spec: {
                  containers: [
                    {
                      image: "ghcr.io/zjy365/seakills-site@sha256:abc123",
                      name: "web",
                    },
                    {
                      image: "ghcr.io/zjy365/unrelated@sha256:def456",
                      name: "sidecar",
                    },
                  ],
                },
              },
            },
          },
        ],
      },
      templateName: "memos",
    }),
    GHCR_BUILD_MATCH_RE
  );
  assert.equal(calls.length, 0);
});
