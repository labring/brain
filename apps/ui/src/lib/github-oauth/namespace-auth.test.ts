import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizeGithubConnectionNamespace } from "./namespace-auth-core";

function kubeconfig(namespace: string) {
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
      namespace: ${namespace}
      user: user
current-context: current
users:
  - name: user
    user:
      token: token
`);
}

test("authorizes a GitHub connection namespace from authenticated kubeconfig", () => {
  assert.deepEqual(
    authorizeGithubConnectionNamespace("ns-sdk", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
    }
  );
});

test("rejects missing GitHub connection namespace", () => {
  assert.deepEqual(
    authorizeGithubConnectionNamespace("", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
    }),
    {
      error: "Missing namespace.",
      ok: false,
      status: 400,
    }
  );
});

test("authorizes from server namespace when kubeconfig has no current namespace", () => {
  const encodedKubeconfig = encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      user: user
current-context: missing
users:
  - name: user
    user:
      token: token
`);

  assert.deepEqual(
    authorizeGithubConnectionNamespace("ns-sdk", {
      serverEncodedKubeconfig: encodedKubeconfig,
      serverNamespace: "ns-sdk",
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: encodedKubeconfig,
    }
  );
});

test("rejects unauthenticated GitHub connection namespace access", () => {
  assert.deepEqual(
    authorizeGithubConnectionNamespace("ns-sdk", {
      serverEncodedKubeconfig: "",
      serverNamespace: "",
    }),
    {
      error: "Authentication is required.",
      ok: false,
      status: 401,
    }
  );
});

test("rejects cross-namespace GitHub connection access", () => {
  assert.deepEqual(
    authorizeGithubConnectionNamespace("ns-b", {
      serverEncodedKubeconfig: kubeconfig("ns-a"),
      serverNamespace: "ns-a",
    }),
    {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    }
  );
});
