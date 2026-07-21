import assert from "node:assert/strict";
import { test } from "node:test";

import type { KubeconfigNamespaceVerification } from "@/lib/request-kubeconfig-auth";
import {
  createGithubConnectionStatusHandler,
  type GithubConnectionStatusLookup,
} from "./connection-status-handler";

function jwt(subject: string, tokenId = "token"): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ jti: tokenId, sub: subject })
  ).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

function kubeconfig(input: { namespace: string; token: string }): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: active-user
current-context: current
users:
  - name: active-user
    user:
      token: ${input.token}
`);
}

function kubeconfigWithTwoUsers(input: {
  activeToken: string;
  inactiveToken: string;
  namespace: string;
}): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: inactive
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: inactive-user
  - name: current
    context:
      cluster: cluster
      namespace: ${input.namespace}
      user: active-user
current-context: current
users:
  - name: inactive-user
    user:
      token: ${input.inactiveToken}
  - name: active-user
    user:
      token: ${input.activeToken}
`);
}

interface StoredConnection {
  accessTokenCiphertext?: string;
  accountLogin: string;
}

function createWorkspaceActorHttpHarness(input: {
  connections: ReadonlyMap<string, StoredConnection>;
  verification?: KubeconfigNamespaceVerification;
}) {
  const authorizationTokens: string[] = [];
  const lookups: Parameters<GithubConnectionStatusLookup>[0][] = [];
  const handler = createGithubConnectionStatusHandler({
    getConnection: (owner) => {
      lookups.push(owner);
      return Promise.resolve(
        input.connections.get(
          `${owner.namespace}:${owner.workspaceActor}:${owner.ownerIdentityVersion}`
        ) ?? null
      );
    },
    verify: ({ token }) => {
      authorizationTokens.push(token);
      return Promise.resolve(input.verification ?? { ok: true });
    },
  });

  return {
    authorizationTokens,
    getStatus: (request: {
      encodedKubeconfig?: string;
      legacyUserId?: string;
      namespace?: string;
      token?: string;
    }) => {
      const url = new URL("https://brain.test/api/github/connection");
      if (request.namespace != null) {
        url.searchParams.set("namespace", request.namespace);
      }
      if (request.legacyUserId != null) {
        url.searchParams.set("userId", request.legacyUserId);
      }
      return handler(
        new Request(url, {
          headers:
            request.encodedKubeconfig == null && request.token == null
              ? undefined
              : {
                  Authorization: `Bearer ${
                    request.encodedKubeconfig ??
                    kubeconfig({
                      namespace: request.namespace ?? "shared",
                      token: request.token ?? "",
                    })
                  }`,
                },
        })
      );
    },
    lookups,
  };
}

test("connection status ignores legacy userId and reads the verified actor's connection", async () => {
  const aliceToken = jwt("system:serviceaccount:user-system:alice-cr");
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      [
        "shared:alice-cr:1",
        { accessTokenCiphertext: "secret", accountLogin: "alice-github" },
      ],
      ["shared:bob-cr:1", { accountLogin: "bob-github" }],
    ]),
  });

  const response = await harness.getStatus({
    legacyUserId: "bob-cr",
    namespace: "shared",
    token: aliceToken,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(harness.authorizationTokens, [aliceToken]);
  assert.deepEqual(harness.lookups, [
    {
      namespace: "shared",
      ownerIdentityVersion: 1,
      workspaceActor: "alice-cr",
    },
  ]);
});

test("members in one namespace see only their own connection status", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "alice-github" }],
      ["shared:bob-cr:1", { accountLogin: "bob-github" }],
    ]),
  });

  const aliceResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });
  const bobResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:bob-cr"),
  });

  assert.deepEqual(await aliceResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(await bobResponse.json(), {
    connection: { accountLogin: "bob-github" },
  });
});

test("rejects an authorized workload ServiceAccount on the personal endpoint", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:shared:default"),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "workspace_actor_required",
    error: "A verified Workspace Actor is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("returns authentication_required when the kubeconfig has no bearer token", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: "",
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "authentication_required",
    error: "Authentication is required.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("checks authentication before validating a missing namespace", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({});

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "authentication_required",
    error: "Authentication is required.",
  });
});

test("returns workspace_actor_required when an authenticated token has no eligible subject", async () => {
  const harness = createWorkspaceActorHttpHarness({ connections: new Map() });

  const response = await harness.getStatus({
    namespace: "shared",
    token: "authenticated-but-not-a-jwt",
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "workspace_actor_required",
    error: "A verified Workspace Actor is required.",
  });
});

test("returns namespace_forbidden when Kubernetes denies namespace access", async () => {
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map(),
    verification: {
      message: "Kubeconfig is not authorized for this namespace.",
      ok: false,
      status: 403,
    },
  });

  const response = await harness.getStatus({
    namespace: "shared",
    token: jwt("system:serviceaccount:user-system:alice-cr"),
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "namespace_forbidden",
    error: "Namespace is not accessible.",
  });
  assert.deepEqual(harness.lookups, []);
});

test("uses the active user token for both namespace authorization and actor resolution", async () => {
  const inactiveToken = jwt("system:serviceaccount:user-system:inactive-cr");
  const activeToken = jwt("system:serviceaccount:user-system:active-cr");
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:active-cr:1", { accountLogin: "active-github" }],
    ]),
  });

  const response = await harness.getStatus({
    encodedKubeconfig: kubeconfigWithTwoUsers({
      activeToken,
      inactiveToken,
      namespace: "shared",
    }),
    namespace: "shared",
  });

  assert.equal(response.status, 200);
  assert.deepEqual(harness.authorizationTokens, [activeToken]);
  assert.deepEqual(harness.lookups, [
    {
      namespace: "shared",
      ownerIdentityVersion: 1,
      workspaceActor: "active-cr",
    },
  ]);
  assert.deepEqual(await response.json(), {
    connection: { accountLogin: "active-github" },
  });
});

test("token rotation preserves the Workspace Actor and connection status", async () => {
  const subject = "system:serviceaccount:user-system:alice-cr";
  const harness = createWorkspaceActorHttpHarness({
    connections: new Map([
      ["shared:alice-cr:1", { accountLogin: "alice-github" }],
    ]),
  });

  const oldTokenResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt(subject, "old-service-account-token"),
  });
  const newTokenResponse = await harness.getStatus({
    namespace: "shared",
    token: jwt(subject, "new-service-account-token"),
  });

  assert.deepEqual(await oldTokenResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(await newTokenResponse.json(), {
    connection: { accountLogin: "alice-github" },
  });
  assert.deepEqual(
    harness.lookups.map((lookup) => lookup.workspaceActor),
    ["alice-cr", "alice-cr"]
  );
});
