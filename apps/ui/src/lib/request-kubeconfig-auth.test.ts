import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  authorizeEncodedKubeconfigNamespace,
  authorizeKubeconfigNamespace,
  authorizeRequestNamespace,
  resolveKubernetesApiServer,
  workspaceActorFromAuthorizedKubeconfig,
} from "./request-kubeconfig-auth";

function kubeconfig(
  namespace: string,
  server = "https://example.test",
  token = "token"
) {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: ${server}
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
      token: ${token}
`);
}

test("resolves the Workspace Actor from the active authorized kubeconfig user", () => {
  const token = [
    Buffer.from("{}").toString("base64url"),
    Buffer.from(
      JSON.stringify({ sub: "system:serviceaccount:user-system:alice-cr" })
    ).toString("base64url"),
    "signature",
  ].join(".");

  assert.equal(
    workspaceActorFromAuthorizedKubeconfig(
      decodeURIComponent(kubeconfig("shared-workspace", undefined, token))
    ),
    "alice-cr"
  );
});

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

test("authorizes the namespace resolved from the active kubeconfig context", async () => {
  const encodedKubeconfig = kubeconfig("ns-sdk");

  assert.deepEqual(
    await authorizeKubeconfigNamespace({
      encodedKubeconfig,
      verify: async () => ({ ok: true }),
    }),
    {
      encodedKubeconfig,
      kubeconfig: decodeURIComponent(encodedKubeconfig),
      namespace: "ns-sdk",
      ok: true,
    }
  );
});

test("rejects a namespace denied by Kubernetes", async () => {
  assert.deepEqual(
    await authorizeKubeconfigNamespace({
      encodedKubeconfig: kubeconfig("ns-sdk"),
      verify: async () => ({
        message: "Kubeconfig is not authorized for this namespace.",
        ok: false,
        status: 403,
      }),
    }),
    {
      code: "verification_failed",
      message: "Kubeconfig is not authorized for this namespace.",
      ok: false,
      status: 403,
    }
  );
});

test("rejects a credential rejected by Kubernetes", async () => {
  assert.deepEqual(
    await authorizeKubeconfigNamespace({
      encodedKubeconfig: kubeconfig("ns-sdk"),
      verify: async () => ({
        message: "Kubeconfig token is not authenticated.",
        ok: false,
        status: 401,
      }),
    }),
    {
      code: "verification_failed",
      message: "Kubeconfig token is not authenticated.",
      ok: false,
      status: 401,
    }
  );
});

test("rejects a malformed encoded kubeconfig before access review", async () => {
  let verified = false;

  assert.deepEqual(
    await authorizeKubeconfigNamespace({
      encodedKubeconfig: "%E0%A4%A",
      verify: () => {
        verified = true;
        return Promise.resolve({ ok: true });
      },
    }),
    {
      code: "invalid_kubeconfig",
      ok: false,
    }
  );
  assert.equal(verified, false);
});

test("rejects malformed kubeconfig YAML before access review", async () => {
  let verified = false;

  assert.deepEqual(
    await authorizeKubeconfigNamespace({
      encodedKubeconfig: encodeURIComponent("contexts: ["),
      verify: () => {
        verified = true;
        return Promise.resolve({ ok: true });
      },
    }),
    {
      code: "namespace_unresolved",
      ok: false,
    }
  );
  assert.equal(verified, false);
});

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

test("preserves authentication rejection for whitespace generic credentials", async () => {
  assert.deepEqual(
    await authorizeEncodedKubeconfigNamespace({
      encodedKubeconfig: "   ",
      namespace: "ns-sdk",
      subject: "Project",
      verify: async () => ({ ok: true }),
    }),
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

test("uses the current kubeconfig API server when running off-cluster", async () => {
  await withJsonServer(
    () => ({ status: { allowed: true } }),
    async (apiServer, requests) => {
      await withEnv(
        {
          KUBERNETES_SERVICE_HOST: undefined,
          KUBERNETES_SERVICE_PORT: undefined,
          NODE_ENV: "development",
        },
        async () => {
          const result = await authorizeEncodedKubeconfigNamespace({
            encodedKubeconfig: kubeconfig("ns-a", `${apiServer}/proxy/cluster`),
            namespace: "ns-a",
            subject: "Project",
          });
          assert.equal(result.ok, true);
        }
      );
      assert.equal(requests.length, 1);
      assert.equal(
        requests[0]?.url,
        "/proxy/cluster/apis/authorization.k8s.io/v1/selfsubjectaccessreviews"
      );
      assert.equal(requests[0]?.headers.authorization, "Bearer token");
    }
  );
});

test("fails closed with partial in-cluster API server coordinates", async () => {
  await withEnv(
    {
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
    resolveKubernetesApiServer({
      inClusterCa: "mounted-cluster-ca",
      kubeconfigCa: "kubeconfig-ca",
      kubeconfigInsecureSkipTlsVerify: true,
      kubeconfigServer: "https://kubeconfig.example:6443",
      serviceHost: "10.0.0.1",
      servicePort: "6443",
    }),
    {
      ca: "mounted-cluster-ca",
      insecureSkipTlsVerify: false,
      ok: true,
      server: "https://10.0.0.1:6443",
      serverName: undefined,
    }
  );
});

test("rejects an in-cluster transport when the mounted CA is missing", () => {
  assert.deepEqual(
    resolveKubernetesApiServer({
      kubeconfigServer: "https://kubeconfig.example:6443",
      serviceHost: "10.0.0.1",
      servicePort: "6443",
    }),
    {
      message: "In-cluster Kubernetes API server CA is unavailable.",
      ok: false,
    }
  );
});

test("formats an IPv6 in-cluster API server", () => {
  assert.deepEqual(
    resolveKubernetesApiServer({
      inClusterCa: "mounted-cluster-ca",
      kubeconfigServer: "https://kubeconfig.example:6443",
      serviceHost: "fd00::1",
      servicePort: "443",
    }),
    {
      ca: "mounted-cluster-ca",
      insecureSkipTlsVerify: false,
      ok: true,
      server: "https://[fd00::1]",
      serverName: undefined,
    }
  );
});

test("uses kubeconfig TLS transport when running off-cluster", () => {
  assert.deepEqual(
    resolveKubernetesApiServer({
      allowKubeconfigTransport: true,
      kubeconfigCa: "kubeconfig-ca",
      kubeconfigInsecureSkipTlsVerify: true,
      kubeconfigServer: "https://kubeconfig.example:6443/",
      kubeconfigServerName: "api.internal",
    }),
    {
      ca: undefined,
      insecureSkipTlsVerify: true,
      ok: true,
      server: "https://kubeconfig.example:6443",
      serverName: "api.internal",
    }
  );
});

test("uses kubeconfig CA when TLS verification is enabled", () => {
  assert.deepEqual(
    resolveKubernetesApiServer({
      allowKubeconfigTransport: true,
      kubeconfigCa: "kubeconfig-ca",
      kubeconfigServer: "https://kubeconfig.example:6443",
    }),
    {
      ca: "kubeconfig-ca",
      insecureSkipTlsVerify: false,
      ok: true,
      server: "https://kubeconfig.example:6443",
      serverName: undefined,
    }
  );
});

test("restricts off-cluster kubeconfig transport to safe development endpoints", () => {
  assert.deepEqual(
    resolveKubernetesApiServer({
      kubeconfigServer: "https://kubeconfig.example:6443",
    }),
    {
      message:
        "Off-cluster Kubernetes API access is available only in development.",
      ok: false,
    }
  );
  assert.deepEqual(
    resolveKubernetesApiServer({
      allowKubeconfigTransport: true,
      kubeconfigServer: "http://kubeconfig.example:6443",
    }),
    {
      message: "Kubernetes API server must use HTTPS unless it is loopback.",
      ok: false,
    }
  );
});
