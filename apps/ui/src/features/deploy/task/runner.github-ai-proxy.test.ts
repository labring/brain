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

import type { DeployTaskRow } from "./schema";

const requireModule = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;
const ENV_KEYS = [
  "AI_PROXY_TOKEN_NAME",
  "CODEX_GATEWAY_MODEL",
  "CODEX_GATEWAY_OPENAI_API_KEY",
  "CODEX_GATEWAY_OPENAI_BASE_URL",
  "DEV_OPENAI_API_KEY",
  "DEV_OPENAI_API_BASE_URL",
  "DEPLOY_DEVBOX_STORAGE_LIMIT",
  "DEVBOX_API_BASE_URL",
  "DEVBOX_TOKEN",
  "SYSTEM_OPENAI_API_KEY",
  "SYSTEM_OPENAI_API_BASE_URL",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;

mock.module("server-only", () => ({}));

const {
  buildCodexGatewayEnv,
  ensureAiDeploymentDevbox,
  resolveGithubCodexGatewayCredentials,
} = requireModule("./runner") as typeof import("./runner");
const {
  CodexGatewayApiError,
  CodexGatewayTimeoutError,
  codexGatewayFailureDetails,
  gatewayStateSnapshot,
} = requireModule("./gateway") as typeof import("./gateway");

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

function installFetchHandler(
  handler: (request: Request) => Promise<Response> | Response
) {
  globalThis.fetch = ((requestInput, init) => {
    return handler(new Request(requestInput, init));
  }) as typeof fetch;
}

function devboxEnvelope(data: unknown): Response {
  return new Response(JSON.stringify({ code: 0, data, message: "" }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function devbox(name: string, phase = "Running") {
  return {
    creationTimestamp: null,
    deletionTimestamp: null,
    name,
    state: { phase, spec: phase, status: phase },
  };
}

function githubTask(runtimeName: string | null): DeployTaskRow {
  return {
    artifactSummary: {},
    blockingInputs: [],
    id: "task-resume-1",
    namespace: "ns-demo",
    phase: "plan",
    projectId: "project-1",
    projectName: "project-1",
    runner: { kind: "ai" },
    runtimeName,
    source: {
      branch: "main",
      kind: "github",
      repo: {
        fullName: "example/repo",
        name: "repo",
        url: "https://github.com/example/repo.git",
      },
    },
    status: "running",
    target: { kind: "existingProject", projectId: "project-1" },
  } as unknown as DeployTaskRow;
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
    delete process.env.DEPLOY_DEVBOX_STORAGE_LIMIT;
    process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
    process.env.DEVBOX_TOKEN = "devbox-test-token";
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

  it("resumes the recorded Devbox without requesting AI Proxy credentials", async () => {
    const requests: Request[] = [];
    let getCount = 0;
    installFetchHandler((request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/pause/refresh")) {
        return devboxEnvelope({});
      }
      if (path.endsWith("/resume")) {
        return devboxEnvelope({});
      }
      if (path === "/api/v1/devbox/existing-devbox") {
        getCount += 1;
        return devboxEnvelope(
          devbox("existing-devbox", getCount === 1 ? "Paused" : "Running")
        );
      }
      return new Response("unexpected request", { status: 500 });
    });

    const runtime = await ensureAiDeploymentDevbox({
      encodedKubeconfig: "invalid-when-unused",
      kubeconfig: "invalid-when-unused",
      task: githubTask("existing-devbox"),
    });

    expect(runtime.name).toBe("existing-devbox");
    expect(requests.map((request) => new URL(request.url).hostname)).toEqual([
      "devbox.test",
      "devbox.test",
      "devbox.test",
      "devbox.test",
    ]);
    expect(requests.some((request) => request.url.endsWith("/resume"))).toBe(
      true
    );
  });

  it("reuses a Devbox found by upstream ID without requesting AI Proxy credentials", async () => {
    const requests: Request[] = [];
    installFetchHandler((request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/devbox" && request.method === "GET") {
        return devboxEnvelope({ items: [devbox("listed-devbox")] });
      }
      if (path === "/api/v1/devbox/listed-devbox") {
        return devboxEnvelope(devbox("listed-devbox"));
      }
      if (path.endsWith("/pause/refresh")) {
        return devboxEnvelope({});
      }
      return new Response("unexpected request", { status: 500 });
    });

    const runtime = await ensureAiDeploymentDevbox({
      encodedKubeconfig: "invalid-when-unused",
      kubeconfig: "invalid-when-unused",
      task: githubTask(null),
    });

    expect(runtime.name).toBe("listed-devbox");
    expect(requests.map((request) => new URL(request.url).hostname)).toEqual([
      "devbox.test",
      "devbox.test",
      "devbox.test",
    ]);
  });

  it("requests AI Proxy credentials only when creating a Devbox", async () => {
    const requests: Request[] = [];
    let createdEnv: Record<string, string> | undefined;
    let createdStorageLimit: string | undefined;
    installFetchHandler(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.hostname === "aiproxy-web.test.sealos.io") {
        return new Response(JSON.stringify({ key: "new-user-key" }), {
          status: 200,
        });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "GET") {
        return devboxEnvelope({ items: [] });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "POST") {
        const body = (await request.json()) as {
          env?: Record<string, string>;
          storageLimit?: string;
        };
        createdEnv = body.env;
        createdStorageLimit = body.storageLimit;
        return devboxEnvelope({});
      }
      if (
        url.pathname.startsWith("/api/v1/devbox/sealai-deploy-") &&
        request.method === "GET"
      ) {
        const name = url.pathname.slice("/api/v1/devbox/".length);
        return devboxEnvelope(devbox(name));
      }
      return new Response("unexpected request", { status: 500 });
    });

    const runtime = await ensureAiDeploymentDevbox({
      encodedKubeconfig: encodeURIComponent(kubeconfig()),
      kubeconfig: kubeconfig(),
      task: githubTask(null),
    });

    expect(runtime.name).toStartWith("sealai-deploy-");
    expect(
      requests.filter(
        (request) =>
          new URL(request.url).hostname === "aiproxy-web.test.sealos.io"
      )
    ).toHaveLength(1);
    expect(createdEnv).toMatchObject({
      CODEX_GATEWAY_OPENAI_API_KEY: "new-user-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://aiproxy.test.sealos.io/v1",
    });
    expect(createdStorageLimit).toBe("10Gi");
  });
});

describe("Codex gateway failure classification", () => {
  it("keeps only an upstream HTTP status for 5xx failures", () => {
    expect(
      codexGatewayFailureDetails(
        new CodexGatewayApiError("private upstream body", 503, {
          token: "private-token",
        })
      )
    ).toEqual({
      httpStatus: 503,
      reason: "gateway-upstream-error",
    });
  });

  it("classifies turn timeouts independently from upstream errors", () => {
    expect(codexGatewayFailureDetails(new CodexGatewayTimeoutError())).toEqual({
      reason: "gateway-timeout",
    });
  });

  it("classifies fetch failures as unavailable", () => {
    expect(codexGatewayFailureDetails(new TypeError("fetch failed"))).toEqual({
      reason: "gateway-unavailable",
    });
  });

  it("persists only allowlisted gateway state metadata", () => {
    const snapshot = gatewayStateSnapshot({
      sessionId: "session-31",
      state: {
        activeTurn: false,
        ready: true,
        recentEvents: [{ error: "Bearer private-token" }],
        transcript: [
          {
            createdAt: 1,
            id: "entry-1",
            role: "assistant",
            source: "gateway",
            status: "failed",
            text: "private gateway stderr",
          },
        ],
      },
    });

    expect(snapshot).toMatchObject({
      activeTurn: false,
      ready: true,
      sessionId: "session-31",
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-token");
    expect(JSON.stringify(snapshot)).not.toContain("private gateway stderr");
  });
});
