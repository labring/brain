import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeGithubConnectionIdentity,
  credentialsWithRequestKubeconfig,
} from "./namespace-auth-core";

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
    authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      userId: "admin",
    }
  );
});

test("rejects missing GitHub connection namespace", () => {
  assert.deepEqual(
    authorizeGithubConnectionIdentity("", "admin", {
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

test("rejects missing GitHub connection user ID", () => {
  assert.deepEqual(
    authorizeGithubConnectionIdentity("ns-sdk", "", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
    }),
    {
      error: "Missing user ID.",
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
    authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: encodedKubeconfig,
      serverNamespace: "ns-sdk",
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: encodedKubeconfig,
      userId: "admin",
    }
  );
});

test("rejects unauthenticated GitHub connection namespace access", () => {
  assert.deepEqual(
    authorizeGithubConnectionIdentity("ns-sdk", "admin", {
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
    authorizeGithubConnectionIdentity("ns-b", "admin", {
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

test("uses request bearer kubeconfig over empty server credentials", () => {
  assert.deepEqual(
    authorizeGithubConnectionIdentity(
      "ns-sdk",
      "admin",
      credentialsWithRequestKubeconfig(
        new Request("https://brain.test/api/github/connection", {
          headers: { Authorization: `Bearer ${kubeconfig("ns-sdk")}` },
        })
      )
    ),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      userId: "admin",
    }
  );
});

test("rejects request bearer kubeconfig namespace mismatch", () => {
  assert.deepEqual(
    authorizeGithubConnectionIdentity(
      "ns-b",
      "admin",
      credentialsWithRequestKubeconfig(
        new Request("https://brain.test/api/github/connection", {
          headers: { Authorization: `Bearer ${kubeconfig("ns-a")}` },
        })
      )
    ),
    {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    }
  );
});
