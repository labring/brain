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

const ALLOW_VERIFY = async () => ({ ok: true }) as const;

test("authorizes a GitHub connection namespace from authenticated kubeconfig", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
      verify: ALLOW_VERIFY,
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      userId: "admin",
    }
  );
});

test("rejects missing GitHub connection namespace", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("", "admin", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
      verify: ALLOW_VERIFY,
    }),
    {
      error: "Missing namespace.",
      ok: false,
      status: 400,
    }
  );
});

test("rejects missing GitHub connection user ID", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
      verify: ALLOW_VERIFY,
    }),
    {
      error: "Missing user ID.",
      ok: false,
      status: 400,
    }
  );
});

test("authorizes from server namespace when kubeconfig has no current namespace", async () => {
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
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: encodedKubeconfig,
      serverNamespace: "ns-sdk",
      verify: ALLOW_VERIFY,
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: encodedKubeconfig,
      userId: "admin",
    }
  );
});

test("rejects unauthenticated GitHub connection namespace access", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: "",
      serverNamespace: "",
      verify: ALLOW_VERIFY,
    }),
    {
      error: "Authentication is required.",
      ok: false,
      status: 401,
    }
  );
});

test("preserves unresolved namespace rejection for whitespace GitHub credentials", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: "   ",
      verify: ALLOW_VERIFY,
    }),
    {
      error: "Could not resolve namespace from authenticated workspace.",
      ok: false,
      status: 400,
    }
  );
});

test("rejects cross-namespace GitHub connection access", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-b", "admin", {
      serverEncodedKubeconfig: kubeconfig("ns-a"),
      serverNamespace: "ns-a",
      verify: ALLOW_VERIFY,
    }),
    {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    }
  );
});

test("uses request bearer kubeconfig over empty server credentials", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      ...credentialsWithRequestKubeconfig(
        new Request("https://brain.test/api/github/connection", {
          headers: { Authorization: `Bearer ${kubeconfig("ns-sdk")}` },
        })
      ),
      verify: ALLOW_VERIFY,
    }),
    {
      namespace: "ns-sdk",
      ok: true,
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      userId: "admin",
    }
  );
});

test("rejects request bearer kubeconfig namespace mismatch", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-b", "admin", {
      ...credentialsWithRequestKubeconfig(
        new Request("https://brain.test/api/github/connection", {
          headers: { Authorization: `Bearer ${kubeconfig("ns-a")}` },
        })
      ),
      verify: ALLOW_VERIFY,
    }),
    {
      error: "namespace does not match authenticated workspace.",
      ok: false,
      status: 403,
    }
  );
});

test("rejects GitHub connection when Kubernetes verification denies access", async () => {
  assert.deepEqual(
    await authorizeGithubConnectionIdentity("ns-sdk", "admin", {
      serverEncodedKubeconfig: kubeconfig("ns-sdk"),
      serverNamespace: "ns-sdk",
      verify: async () => ({
        message: "Kubeconfig is not authorized for this namespace.",
        ok: false,
        status: 403,
      }),
    }),
    {
      error: "Kubeconfig is not authorized for this namespace.",
      ok: false,
      status: 403,
    }
  );
});
