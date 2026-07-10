import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  authorizeEncodedKubeconfigNamespace,
  authorizeRequestNamespace,
  resolveTrustedKubernetesApiServer,
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

async function withJsonServer<T>(
  handler: (request: import("node:http").IncomingMessage) => unknown,
  run: (
    url: string,
    requests: import("node:http").IncomingMessage[]
  ) => Promise<T>
): Promise<T> {
  const requests: import("node:http").IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(handler(request)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP address.");
  }
  const url = `http://127.0.0.1:${address.port}`;
  try {
    return await run(url, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error == null ? resolve() : reject(error)))
    );
  }
}

function withEnv<T>(
  values: Partial<NodeJS.ProcessEnv>,
  run: () => Promise<T>
): Promise<T> {
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("authorizes request namespace from bearer kubeconfig", async () => {
  const request = new Request("https://brain.test/api/projects", {
    headers: {
      Authorization: `Bearer ${kubeconfig("ns-sdk")}`,
    },
  });

  const result = await authorizeRequestNamespace(request, {
    namespace: "ns-sdk",
    subject: "Project",
    verify: async () => ({ ok: true }),
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.namespace, "ns-sdk");
  }
});

test("rejects missing request bearer kubeconfig", async () => {
  assert.deepEqual(
    await authorizeRequestNamespace(
      new Request("https://brain.test/api/projects"),
      {
        namespace: "ns-sdk",
        subject: "Project",
        verify: async () => ({ ok: true }),
      }
    ),
    {
      message: "Authentication is required.",
      ok: false,
      status: 401,
    }
  );
});

test("rejects kubeconfig namespace mismatch", async () => {
  assert.deepEqual(
    await authorizeEncodedKubeconfigNamespace({
      encodedKubeconfig: kubeconfig("ns-a"),
      namespace: "ns-b",
      subject: "Project",
      verify: async () => ({ ok: true }),
    }),
    {
      message: "Project namespace is not accessible.",
      ok: false,
      status: 403,
    }
  );
});

test("rejects kubeconfig when Kubernetes verification denies access", async () => {
  assert.deepEqual(
    await authorizeEncodedKubeconfigNamespace({
      encodedKubeconfig: kubeconfig("ns-a"),
      namespace: "ns-a",
      subject: "Project",
      verify: async () => ({
        message: "Kubeconfig is not authorized for this namespace.",
        ok: false,
        status: 403,
      }),
    }),
    {
      message: "Kubeconfig is not authorized for this namespace.",
      ok: false,
      status: 403,
    }
  );
});

test("fails closed when no trusted API server is configured", async () => {
  await withJsonServer(
    () => ({ status: { allowed: true } }),
    async (apiServer, requests) => {
      // A client kubeconfig can name any server; without a trusted API server
      // configured (K8S_API_URL / in-cluster env) verification must NOT fall
      // back to that client-named server (F5: SSRF + authz bypass).
      const encodedKubeconfig = kubeconfig("ns-a").replace(
        "https%3A%2F%2Fexample.test",
        encodeURIComponent(apiServer)
      );

      await withEnv(
        {
          K8S_API_CA: undefined,
          K8S_API_URL: undefined,
          KUBERNETES_SERVICE_HOST: undefined,
          KUBERNETES_SERVICE_PORT: undefined,
        },
        async () => {
          const result = await authorizeEncodedKubeconfigNamespace({
            encodedKubeconfig,
            namespace: "ns-a",
            subject: "Project",
          });
          assert.equal(result.ok, false);
          if (!result.ok) {
            assert.equal(result.status, 500);
          }
        }
      );
      // The client-named server must never be contacted.
      assert.equal(requests.length, 0);
    }
  );
});

test("uses in-cluster API server instead of kubeconfig server for verification", async () => {
  await withJsonServer(
    () => ({ status: { allowed: true } }),
    async (trustedApiServer, requests) => {
      const trusted = new URL(trustedApiServer);
      await withEnv(
        {
          K8S_API_CA: undefined,
          K8S_API_URL: undefined,
          KUBERNETES_SERVICE_HOST: trusted.hostname,
          KUBERNETES_SERVICE_PORT: trusted.port,
        },
        async () => {
          assert.deepEqual(
            await authorizeEncodedKubeconfigNamespace({
              encodedKubeconfig: kubeconfig("ns-a"),
              namespace: "ns-a",
              subject: "Project",
            }),
            {
              message: "Kubernetes access review failed.",
              ok: false,
              status: 502,
            }
          );
        }
      );
      assert.equal(requests.length, 0);
    }
  );
});

test("prefers in-cluster API server over explicit off-cluster URL", async () => {
  await withJsonServer(
    () => ({ status: { allowed: true } }),
    async (inClusterApiServer, requests) => {
      const inCluster = new URL(inClusterApiServer);
      await withEnv(
        {
          K8S_API_CA: undefined,
          // This deliberately-invalid development fallback must be ignored in a Pod.
          K8S_API_URL: "http://off-cluster.example:6443",
          KUBERNETES_SERVICE_HOST: inCluster.hostname,
          KUBERNETES_SERVICE_PORT: inCluster.port,
        },
        async () => {
          assert.deepEqual(
            await authorizeEncodedKubeconfigNamespace({
              encodedKubeconfig: kubeconfig("ns-a"),
              namespace: "ns-a",
              subject: "Project",
            }),
            {
              message: "Kubernetes access review failed.",
              ok: false,
              status: 502,
            }
          );
        }
      );
      assert.equal(requests.length, 0);
    }
  );
});

test("uses explicit API server only when running off-cluster", async () => {
  await withEnv(
    {
      K8S_API_CA: undefined,
      K8S_API_URL: "http://off-cluster.example:6443",
      KUBERNETES_SERVICE_HOST: undefined,
      KUBERNETES_SERVICE_PORT: undefined,
    },
    async () => {
      assert.deepEqual(
        await authorizeEncodedKubeconfigNamespace({
          encodedKubeconfig: kubeconfig("ns-a"),
          namespace: "ns-a",
          subject: "Project",
        }),
        {
          message: "Trusted Kubernetes API server must use https.",
          ok: false,
          status: 500,
        }
      );
    }
  );
});

test("fails closed with partial in-cluster API server coordinates", async () => {
  await withEnv(
    {
      K8S_API_CA: undefined,
      K8S_API_URL: "http://off-cluster.example:6443",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
      KUBERNETES_SERVICE_PORT: undefined,
    },
    async () => {
      assert.deepEqual(
        await authorizeEncodedKubeconfigNamespace({
          encodedKubeconfig: kubeconfig("ns-a"),
          namespace: "ns-a",
          subject: "Project",
        }),
        {
          message:
            "In-cluster Kubernetes API server configuration is incomplete.",
          ok: false,
          status: 500,
        }
      );
    }
  );
});

test("pairs the mounted CA with the preferred in-cluster API server", () => {
  assert.deepEqual(
    resolveTrustedKubernetesApiServer({
      explicitCa: "stale-development-ca",
      explicitUrl: "https://off-cluster.example:6443",
      inClusterCa: "mounted-cluster-ca",
      serviceHost: "10.0.0.1",
      servicePort: "6443",
    }),
    {
      ca: "mounted-cluster-ca",
      ok: true,
      server: "https://10.0.0.1:6443",
    }
  );
});

test("falls back to the explicit CA when the in-cluster mount is missing", () => {
  assert.deepEqual(
    resolveTrustedKubernetesApiServer({
      explicitCa: "operator-cluster-ca",
      explicitUrl: "https://off-cluster.example:6443",
      serviceHost: "10.0.0.1",
      servicePort: "6443",
    }),
    {
      ca: "operator-cluster-ca",
      ok: true,
      server: "https://10.0.0.1:6443",
    }
  );
});
