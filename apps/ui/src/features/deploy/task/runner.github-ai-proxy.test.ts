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
  "CODEX_GATEWAY_MODEL",
  "CODEX_GATEWAY_OPENAI_API_KEY",
  "CODEX_GATEWAY_OPENAI_BASE_URL",
  "DEV_OPENAI_API_KEY",
  "DEV_OPENAI_API_BASE_URL",
  "SYSTEM_OPENAI_API_KEY",
  "SYSTEM_OPENAI_API_BASE_URL",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

mock.module("server-only", () => ({}));

const { buildCodexGatewayEnv, resolveGithubCodexGatewayCredentials } =
  requireModule("./runner") as typeof import("./runner");

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
  status: number;
  onRequest?: (request: Request) => void;
}) {
  globalThis.fetch = ((requestInput, init) => {
    const request = new Request(requestInput, init);
    input.onRequest?.(request);
    return Promise.resolve(
      new Response(input.body, {
        headers: { "Content-Type": "application/json" },
        status: input.status,
      })
    );
  }) as typeof fetch;
}

function setPlatformCredentials() {
  process.env.CODEX_GATEWAY_OPENAI_API_KEY = "gateway-platform-key";
  process.env.CODEX_GATEWAY_OPENAI_BASE_URL =
    "https://gateway-platform.example/v1";
  process.env.DEV_OPENAI_API_KEY = "dev-platform-key";
  process.env.DEV_OPENAI_API_BASE_URL = "https://dev-platform.example/v1";
  process.env.SYSTEM_OPENAI_API_KEY = "system-platform-key";
  process.env.SYSTEM_OPENAI_API_BASE_URL = "https://system-platform.example/v1";
}

describe("GitHub deployment AI Proxy credentials", () => {
  beforeEach(() => {
    setPlatformCredentials();
    process.env.AI_PROXY_TOKEN_NAME = "github-deploy-token";
    process.env.CODEX_GATEWAY_MODEL = "deploy-model";
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

  it("uses the kubeconfig-authorized AI Proxy key and URL for Devbox env", async () => {
    const kubeconfigText = kubeconfig();
    const encodedKubeconfig = encodeURIComponent(kubeconfigText);
    let observedRequest: Request | undefined;
    installFetchResponse({
      body: JSON.stringify({ key: "user-ai-proxy-key" }),
      onRequest: (request) => {
        observedRequest = request;
      },
      status: 200,
    });

    const credentials = await resolveGithubCodexGatewayCredentials({
      encodedKubeconfig,
      kubeconfig: kubeconfigText,
    });

    expect(credentials).toEqual({
      apiKey: "user-ai-proxy-key",
      baseUrl: "https://aiproxy.test.sealos.io/v1",
    });
    expect(buildCodexGatewayEnv(credentials)).toEqual({
      CODEX_GATEWAY_MODEL: "deploy-model",
      CODEX_GATEWAY_OPENAI_API_KEY: "user-ai-proxy-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://aiproxy.test.sealos.io/v1",
    });
    expect(observedRequest?.method).toBe("POST");
    expect(observedRequest?.url).toBe(
      "https://aiproxy-web.test.sealos.io/api/v2alpha/tokens"
    );
    expect(observedRequest?.headers.get("Authorization")).toBe(
      encodedKubeconfig
    );
    await expect(observedRequest?.json()).resolves.toEqual({
      name: "github-deploy-token",
    });
  });

  it("never falls back to platform credentials for a GitHub deployment", async () => {
    const kubeconfigText = kubeconfig();
    installFetchResponse({
      body: JSON.stringify({ key: "user-only-key" }),
      status: 200,
    });

    const credentials = await resolveGithubCodexGatewayCredentials({
      encodedKubeconfig: encodeURIComponent(kubeconfigText),
      kubeconfig: kubeconfigText,
    });
    const env = buildCodexGatewayEnv(credentials);

    expect(env.CODEX_GATEWAY_OPENAI_API_KEY).toBe("user-only-key");
    expect(env.CODEX_GATEWAY_OPENAI_BASE_URL).toBe(
      "https://aiproxy.test.sealos.io/v1"
    );
    expect(Object.values(env)).not.toContain("gateway-platform-key");
    expect(Object.values(env)).not.toContain("dev-platform-key");
    expect(Object.values(env)).not.toContain("system-platform-key");
  });

  it("fails closed without exposing the AI Proxy response body", async () => {
    const kubeconfigText = kubeconfig();
    installFetchResponse({
      body: "upstream-secret-response",
      status: 503,
    });

    const result = resolveGithubCodexGatewayCredentials({
      encodedKubeconfig: encodeURIComponent(kubeconfigText),
      kubeconfig: kubeconfigText,
    });

    await expect(result).rejects.toThrow(
      "Could not obtain the user's AI Proxy key for GitHub deployment (HTTP 503)."
    );
    await expect(result).rejects.not.toThrow("upstream-secret-response");
  });

  it("does not call AI Proxy when the kubeconfig hostname is invalid", async () => {
    let fetchCalled = false;
    installFetchResponse({
      body: JSON.stringify({ key: "unexpected" }),
      onRequest: () => {
        fetchCalled = true;
      },
      status: 200,
    });

    const result = resolveGithubCodexGatewayCredentials({
      encodedKubeconfig: "invalid-kubeconfig",
      kubeconfig: "not: [valid",
    });

    await expect(result).rejects.toThrow(
      "Could not read the Kubernetes API server hostname"
    );
    expect(fetchCalled).toBe(false);
  });

  it("preserves the existing platform env behavior when no user credentials are supplied", () => {
    expect(buildCodexGatewayEnv()).toEqual({
      CODEX_GATEWAY_MODEL: "deploy-model",
      CODEX_GATEWAY_OPENAI_API_KEY: "gateway-platform-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://gateway-platform.example/v1",
    });
  });
});
