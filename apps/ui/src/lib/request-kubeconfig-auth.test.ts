import assert from "node:assert/strict";
import { test } from "node:test";

import {
  authorizeEncodedKubeconfigNamespace,
  authorizeRequestNamespace,
} from "./request-kubeconfig-auth";

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

test("authorizes request namespace from bearer kubeconfig", () => {
  const request = new Request("https://brain.test/api/projects", {
    headers: {
      Authorization: `Bearer ${kubeconfig("ns-sdk")}`,
    },
  });

  const result = authorizeRequestNamespace(request, {
    namespace: "ns-sdk",
    subject: "Project",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.namespace, "ns-sdk");
  }
});

test("rejects missing request bearer kubeconfig", () => {
  assert.deepEqual(
    authorizeRequestNamespace(new Request("https://brain.test/api/projects"), {
      namespace: "ns-sdk",
      subject: "Project",
    }),
    {
      message: "Authentication is required.",
      ok: false,
      status: 401,
    }
  );
});

test("rejects kubeconfig namespace mismatch", () => {
  assert.deepEqual(
    authorizeEncodedKubeconfigNamespace({
      encodedKubeconfig: kubeconfig("ns-a"),
      namespace: "ns-b",
      subject: "Project",
    }),
    {
      message: "Project namespace is not accessible.",
      ok: false,
      status: 403,
    }
  );
});
