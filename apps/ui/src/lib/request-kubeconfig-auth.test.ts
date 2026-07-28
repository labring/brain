import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { SignJWT } from "jose";

import {
  authorizeEncodedKubeconfigNamespace,
  authorizeKubeconfigNamespace,
  authorizeRequestNamespace,
  authorizeWorkspaceActor,
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

// --- Workspace Actor authorization with the desktop-minted App Token ---

const APP_TOKEN_SECRET = "cluster-shared-jwt-internal";
const APP_TOKEN_REGION_UID = "0f2a6f47-6dcb-4a76-b177-6c0aa22eaf6e";
const APP_TOKEN_USER_UID = "6bd90648-b8b9-4a70-9be0-95c8391a0dcb";
const APP_TOKEN_CONFIG = {
  regionUid: APP_TOKEN_REGION_UID,
  secret: APP_TOKEN_SECRET,
};

function serviceAccountJwt(subject: string): string {
  return [
    Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
      "base64url"
    ),
    Buffer.from(JSON.stringify({ sub: subject })).toString("base64url"),
    "signature",
  ].join(".");
}

function actorKubeconfig(namespace: string, crName: string): string {
  return kubeconfig(
    namespace,
    undefined,
    serviceAccountJwt(`system:serviceaccount:user-system:${crName}`)
  );
}

function mintAppToken(
  overrides: {
    claims?: Record<string, unknown>;
    expiresAt?: number;
    secret?: string;
  } = {}
): Promise<string> {
  const jwt = new SignJWT({
    regionUid: APP_TOKEN_REGION_UID,
    userCrName: "alice-cr",
    userUid: APP_TOKEN_USER_UID,
    ...overrides.claims,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(1_753_600_000);
  if (overrides.expiresAt !== undefined) {
    jwt.setExpirationTime(overrides.expiresAt);
  }
  return jwt.sign(
    new TextEncoder().encode(overrides.secret ?? APP_TOKEN_SECRET)
  );
}

function authorizeActor(input: {
  appToken: string | undefined;
  crName?: string;
}) {
  return authorizeWorkspaceActor({
    appToken: input.appToken,
    appTokenConfig: APP_TOKEN_CONFIG,
    encodedKubeconfig: actorKubeconfig("shared", input.crName ?? "alice-cr"),
    verify: async () => ({ ok: true }),
  });
}

test("authorizes the actor when all four app-token checks pass", async () => {
  assert.deepEqual(await authorizeActor({ appToken: await mintAppToken() }), {
    actorBinding: {
      crName: "alice-cr",
      mintedAt: 1_753_600_000,
      userUid: APP_TOKEN_USER_UID,
    },
    namespace: "shared",
    ok: true,
    workspaceActor: "alice-cr",
  });
});

test("accepts an expired but otherwise valid app token", async () => {
  const authorization = await authorizeActor({
    appToken: await mintAppToken({ expiresAt: 1_753_600_001 }),
  });
  assert.equal(authorization.ok, true);
});

test("a missing app token is refused with 401 and fails closed", async () => {
  const authorization = await authorizeActor({ appToken: undefined });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "app_token_required");
    assert.equal(authorization.status, 401);
  }
});

test("an app token with a forged signature is refused with 401", async () => {
  const authorization = await authorizeActor({
    appToken: await mintAppToken({ secret: "attacker-secret" }),
  });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "app_token_invalid");
    assert.equal(authorization.status, 401);
  }
});

test("an app token bound to another crName is refused with 403", async () => {
  const authorization = await authorizeActor({
    appToken: await mintAppToken({ claims: { userCrName: "mallory-cr" } }),
  });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "app_token_mismatch");
    assert.equal(authorization.status, 403);
  }
});

test("an app token minted for another region is refused with 403", async () => {
  const authorization = await authorizeActor({
    appToken: await mintAppToken({
      claims: { regionUid: "b9a1c9c1-a1de-4c26-9c58-0f9b9c3c2f5d" },
    }),
  });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "app_token_mismatch");
    assert.equal(authorization.status, 403);
  }
});

test("an ineligible kubeconfig subject stays a distinct 403 despite a valid app token", async () => {
  const authorization = await authorizeWorkspaceActor({
    appToken: await mintAppToken(),
    appTokenConfig: APP_TOKEN_CONFIG,
    encodedKubeconfig: kubeconfig(
      "shared",
      undefined,
      serviceAccountJwt("system:serviceaccount:other-system:alice-cr")
    ),
    verify: async () => ({ ok: true }),
  });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "workspace_actor_required");
    assert.equal(authorization.status, 403);
  }
});

test("absent verification config fails closed with 401 on the same code path", async () => {
  const authorization = await authorizeWorkspaceActor({
    appToken: await mintAppToken(),
    appTokenConfig: null,
    encodedKubeconfig: actorKubeconfig("shared", "alice-cr"),
    verify: async () => ({ ok: true }),
  });
  assert.equal(authorization.ok, false);
  if (!authorization.ok) {
    assert.equal(authorization.code, "app_token_invalid");
    assert.equal(authorization.status, 401);
  }
});
