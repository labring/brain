import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "AI_PROXY_TOKEN_NAME",
  "DEV_OPENAI_API_BASE_URL",
  "DEV_OPENAI_API_KEY",
  "SYSTEM_OPENAI_API_BASE_URL",
  "SYSTEM_OPENAI_API_KEY",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

mock.module("server-only", () => ({}));

const { resolveUserAiProxyCredentials } = requireModule(
  "./resolve-user-ai-proxy-credentials"
) as typeof import("./resolve-user-ai-proxy-credentials");
const { resolveChatOpenAiConnection } = requireModule(
  "@/features/chat/ai-proxy/resolve-chat-open-ai-connection"
) as typeof import("@/features/chat/ai-proxy/resolve-chat-open-ai-connection");

function kubeconfig(clusterHostname = "test.sealos.io"): string {
  return [
    "apiVersion: v1",
    "current-context: test-context",
    "clusters:",
    "  - name: test-cluster",
    "    cluster:",
    `      server: https://${clusterHostname}:6443`,
    "contexts:",
    "  - name: test-context",
    "    context:",
    "      cluster: test-cluster",
  ].join("\n");
}

function installFetchResponse(input: {
  body: string;
  onRequest?: (request: Request) => void;
  status: number;
}) {
  globalThis.fetch = ((requestInput, init) => {
    const request = new Request(requestInput, init);
    input.onRequest?.(request);
    return Promise.resolve(new Response(input.body, { status: input.status }));
  }) as typeof fetch;
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("user AI Proxy credentials", () => {
  it("resolves credentials with the shared default token name", async () => {
    let observedRequest: Request | undefined;
    installFetchResponse({
      body: JSON.stringify({ key: "user-key" }),
      onRequest: (request) => {
        observedRequest = request;
      },
      status: 200,
    });

    const result = await resolveUserAiProxyCredentials({
      encodedKubeconfig: "encoded-kubeconfig",
      kubeconfigText: kubeconfig(),
    });

    expect(result).toEqual({
      credentials: {
        apiKey: "user-key",
        baseUrl: "https://aiproxy.test.sealos.io/v1",
      },
      ok: true,
    });
    expect(observedRequest?.headers.get("Authorization")).toBe(
      encodeURIComponent(kubeconfig())
    );
    await expect(observedRequest?.json()).resolves.toEqual({
      name: "sealos-brain",
    });
  });

  it("rejects missing or invalid kubeconfig before calling AI Proxy", async () => {
    let fetchCalled = false;
    installFetchResponse({
      body: "unexpected",
      onRequest: () => {
        fetchCalled = true;
      },
      status: 500,
    });

    await expect(
      resolveUserAiProxyCredentials({
        encodedKubeconfig: undefined,
        kubeconfigText: kubeconfig(),
      })
    ).resolves.toEqual({
      ok: false,
      reason: "missing-kubeconfig",
      status: 400,
    });
    await expect(
      resolveUserAiProxyCredentials({
        encodedKubeconfig: "encoded-kubeconfig",
        kubeconfigText: "not: [valid",
      })
    ).resolves.toEqual({
      ok: false,
      reason: "invalid-kubeconfig",
      status: 400,
    });
    expect(fetchCalled).toBe(false);
  });

  it("returns structured token failures for caller-specific error handling", async () => {
    installFetchResponse({ body: "quota exceeded", status: 429 });

    await expect(
      resolveUserAiProxyCredentials({
        encodedKubeconfig: "encoded-kubeconfig",
        kubeconfigText: kubeconfig(),
      })
    ).resolves.toEqual({
      ok: false,
      reason: "token-request-failed",
      status: 429,
      upstreamBodyText: "quota exceeded",
    });
  });
});

describe("chat OpenAI connection policy", () => {
  it("keeps the development override ahead of billing policy", async () => {
    process.env.DEV_OPENAI_API_KEY = "dev-key";
    process.env.DEV_OPENAI_API_BASE_URL = "https://dev.example/v1";

    await expect(
      resolveChatOpenAiConnection({
        billing: "user",
        encodedKubeconfig: undefined,
        kubeconfigText: "invalid",
      })
    ).resolves.toEqual({
      connection: { apiKey: "dev-key", baseURL: "https://dev.example/v1" },
      ok: true,
    });
  });

  it("keeps free billing on the system connection", async () => {
    process.env.SYSTEM_OPENAI_API_KEY = "system-key";
    process.env.SYSTEM_OPENAI_API_BASE_URL = "https://system.example/v1";

    await expect(
      resolveChatOpenAiConnection({
        billing: "free",
        encodedKubeconfig: undefined,
        kubeconfigText: "invalid",
      })
    ).resolves.toEqual({
      connection: {
        apiKey: "system-key",
        baseURL: "https://system.example/v1",
      },
      ok: true,
    });
  });

  it("maps a user-billed token failure to the existing chat response", async () => {
    installFetchResponse({ body: "quota exceeded", status: 429 });

    await expect(
      resolveChatOpenAiConnection({
        billing: "user",
        encodedKubeconfig: "encoded-kubeconfig",
        kubeconfigText: kubeconfig(),
      })
    ).resolves.toEqual({
      message: "quota exceeded",
      ok: false,
      status: 429,
    });
  });
});
