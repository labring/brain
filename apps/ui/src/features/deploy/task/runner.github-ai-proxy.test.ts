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
const PINNED_SKILL_COMMIT_SOURCE_RE = /sealos-skills\.git#[0-9a-f]{7,}/;
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
  "GITHUB_DEPLOY_MODEL",
  "GITHUB_DEPLOY_OPENAI_API_KEY",
  "GITHUB_DEPLOY_OPENAI_BASE_URL",
  "LANGFUSE_HOST",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "SYSTEM_OPENAI_API_KEY",
  "SYSTEM_OPENAI_API_BASE_URL",
  "SEALAI_DEPLOY_LABELS_JSON",
  "SEALAI_PROJECT_ID",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof ENV_KEYS)[number], string | undefined>;
const RESOLVED_GATEWAY_CREDENTIALS = {
  apiKey: "resolved-key",
  baseUrl: "https://resolved.example/v1",
};

mock.module("server-only", () => ({}));

const {
  buildCodexGatewayEnv,
  buildDeploySkillInstallCommand,
  buildManagedWorkspacePurgeCommand,
  createManagedDeploymentLifecycleState,
  enterManagedDeploymentRepair,
  ensureAiDeploymentDevbox,
  githubDeployOpenAiOverride,
  resolveCodexGatewayCredentials,
} = requireModule("./runner") as typeof import("./runner");
const { getDeploySkillSourceFromEnv } = requireModule(
  "./runtime-config"
) as typeof import("./runtime-config");
const {
  CodexGatewayApiError,
  CodexGatewayTimeoutError,
  CodexGatewayTurnError,
  codexGatewayFailureDetails,
  gatewayEventProjection,
  gatewayStateSnapshot,
  safeCodexGatewayUrl,
  safeGatewaySessionIdentifier,
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

describe("deploy skill installation", () => {
  it("installs from the configured branch source without pinning a commit", () => {
    const command = buildDeploySkillInstallCommand(
      "https://github.com/labring/sealos-skills/tree/brain-deploy-preview"
    );

    expect(command).toContain(
      "https://github.com/labring/sealos-skills/tree/brain-deploy-preview"
    );
    expect(command).toContain(
      'npx --yes skills@1.5.20 add "$skill_source" --agent codex -y'
    );
    expect(command).not.toContain("rm -rf");
    expect(command).not.toContain("skills-lock.json");
    expect(command).not.toContain("required_skill_names");
    expect(command).not.toContain("deploy-skills-revision");
    expect(command).not.toContain("sealos-skills-install.marker");
    expect(command).not.toMatch(PINNED_SKILL_COMMIT_SOURCE_RE);
  });

  it("defaults to the unified Brain deployment branch via runtime config", () => {
    expect(getDeploySkillSourceFromEnv({})).toBe(
      "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy"
    );
    const command = buildDeploySkillInstallCommand(
      getDeploySkillSourceFromEnv({})
    );
    expect(command).toContain(
      "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy"
    );
  });
});

describe("managed deployment workspace cleanup", () => {
  it("purges and verifies only the fixed task workspace", () => {
    const command = buildManagedWorkspacePurgeCommand();

    expect(command).toContain("/home/devbox/project");
    expect(command).toContain("-mindepth 1 -maxdepth 1");
    expect(command).toContain("rm -rf");
    expect(command).toContain("-print -quit");
    expect(command).not.toContain("/home/devbox/project/.sealos/brain");
  });

  it("keeps submitted inputs available across repair turns", () => {
    const submitted = createManagedDeploymentLifecycleState("input-submitted");
    const repair = enterManagedDeploymentRepair(submitted);

    expect(repair).toEqual({
      inputsSubmitted: true,
      resumeMode: "repair",
    });
  });

  it("does not invent submitted inputs for an initial repair", () => {
    const initial = createManagedDeploymentLifecycleState("initial");
    const repair = enterManagedDeploymentRepair(initial);

    expect(repair).toEqual({
      inputsSubmitted: false,
      resumeMode: "repair",
    });
  });
});

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

function promptTask(runtimeName: string | null): DeployTaskRow {
  return {
    ...githubTask(runtimeName),
    source: { kind: "prompt", text: "Deploy a small web application" },
  } as DeployTaskRow;
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

describe("deployment AI Proxy credentials", () => {
  beforeEach(() => {
    setPlatformCredentials();
    process.env.AI_PROXY_TOKEN_NAME = "github-deploy-token";
    process.env.GITHUB_DEPLOY_MODEL = "deploy-model";
    delete process.env.CODEX_GATEWAY_MODEL;
    delete process.env.DEPLOY_DEVBOX_STORAGE_LIMIT;
    process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
    process.env.DEVBOX_TOKEN = "devbox-test-token";
    process.env.DEPLOY_AGENT_MCP_URL =
      "https://brain.test/api/deploy-agent/mcp/v1";
    delete process.env.GITHUB_DEPLOY_OPENAI_API_KEY;
    delete process.env.GITHUB_DEPLOY_OPENAI_BASE_URL;
    delete process.env.LANGFUSE_HOST;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
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

    const credentials = await resolveCodexGatewayCredentials({
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

  it("never falls back to platform credentials for an AI deployment", async () => {
    const kubeconfigText = kubeconfig();
    installFetchResponse({
      body: JSON.stringify({ key: "user-only-key" }),
      status: 200,
    });

    const credentials = await resolveCodexGatewayCredentials({
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

    const result = resolveCodexGatewayCredentials({
      encodedKubeconfig: encodeURIComponent(kubeconfigText),
      kubeconfig: kubeconfigText,
    });

    await expect(result).rejects.toThrow(
      "Could not obtain the user's AI Proxy key for deployment (HTTP 503)."
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

    const result = resolveCodexGatewayCredentials({
      encodedKubeconfig: "invalid-kubeconfig",
      kubeconfig: "not: [valid",
    });

    await expect(result).rejects.toThrow(
      "Could not read the Kubernetes API server hostname"
    );
    expect(fetchCalled).toBe(false);
  });

  it("falls back to gpt-5.5 when GITHUB_DEPLOY_MODEL is unset", () => {
    delete process.env.GITHUB_DEPLOY_MODEL;
    expect(
      buildCodexGatewayEnv(RESOLVED_GATEWAY_CREDENTIALS).CODEX_GATEWAY_MODEL
    ).toBe("gpt-5.5");
  });

  it("does not take the Devbox model from CODEX_GATEWAY_MODEL", () => {
    delete process.env.GITHUB_DEPLOY_MODEL;
    process.env.CODEX_GATEWAY_MODEL = "gpt-chat-only";
    expect(
      buildCodexGatewayEnv(RESOLVED_GATEWAY_CREDENTIALS).CODEX_GATEWAY_MODEL
    ).toBe("gpt-5.5");
    process.env.GITHUB_DEPLOY_MODEL = "deploy-model";
    expect(
      buildCodexGatewayEnv(RESOLVED_GATEWAY_CREDENTIALS).CODEX_GATEWAY_MODEL
    ).toBe("deploy-model");
  });

  it("forwards trimmed LANGFUSE_* values when they are set", () => {
    process.env.LANGFUSE_PUBLIC_KEY = "  pk-lf-test  ";
    process.env.LANGFUSE_SECRET_KEY = " sk-lf-test ";
    process.env.LANGFUSE_HOST = " https://langfuse.example.com ";
    expect(buildCodexGatewayEnv()).toEqual({
      CODEX_GATEWAY_MODEL: "deploy-model",
      CODEX_GATEWAY_OPENAI_API_KEY: "gateway-platform-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://gateway-platform.example/v1",
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_HOST: "https://langfuse.example.com",
    });
  });

  it("uses GITHUB_DEPLOY_OPENAI_* when both are set", () => {
    process.env.GITHUB_DEPLOY_OPENAI_API_KEY = "  github-override-key  ";
    process.env.GITHUB_DEPLOY_OPENAI_BASE_URL = " https://override.example/v1 ";
    expect(githubDeployOpenAiOverride()).toEqual({
      apiKey: "github-override-key",
      baseUrl: "https://override.example/v1",
    });
  });

  it("does not reuse Chat Agent or host Codex credentials when the GitHub pair is unset", () => {
    expect(githubDeployOpenAiOverride()).toBeNull();
  });

  it("treats blank GITHUB_DEPLOY_OPENAI_* values as unset", () => {
    process.env.GITHUB_DEPLOY_OPENAI_API_KEY = "   ";
    process.env.GITHUB_DEPLOY_OPENAI_BASE_URL = "";
    expect(githubDeployOpenAiOverride()).toBeNull();
  });

  it("fails closed when only one GITHUB_DEPLOY_OPENAI_* value is set", () => {
    process.env.GITHUB_DEPLOY_OPENAI_API_KEY = "github-override-key";
    expect(() => githubDeployOpenAiOverride()).toThrow(
      "GitHub deploy OpenAI override requires both GITHUB_DEPLOY_OPENAI_API_KEY and GITHUB_DEPLOY_OPENAI_BASE_URL."
    );
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
      taskDeadlineAtMs: Date.now() + 60_000,
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

  it("propagates an abort signal into an in-flight Devbox request", async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      requestStarted = resolve;
    });
    installFetchHandler(
      (request) =>
        new Promise<Response>((_resolve, reject) => {
          requestStarted();
          const onAbort = () => {
            reject(request.signal.reason);
          };
          request.signal.addEventListener("abort", onAbort, { once: true });
        })
    );

    const pending = ensureAiDeploymentDevbox({
      deadlineAtMs: Date.now() + 60_000,
      encodedKubeconfig: "invalid-when-unused",
      kubeconfig: "invalid-when-unused",
      signal: controller.signal,
      task: githubTask("existing-devbox"),
      taskDeadlineAtMs: Date.now() + 60_000,
    });
    await started;
    controller.abort(new Error("devbox deadline reached"));

    await expect(pending).rejects.toThrow("devbox deadline reached");
  });

  it("aborts an in-flight AI Proxy token request before creating a Devbox", async () => {
    delete process.env.CODEX_GATEWAY_OPENAI_API_KEY;
    delete process.env.CODEX_GATEWAY_OPENAI_BASE_URL;
    delete process.env.SYSTEM_OPENAI_API_KEY;
    delete process.env.SYSTEM_OPENAI_API_BASE_URL;
    const controller = new AbortController();
    let tokenRequestStarted!: () => void;
    const tokenRequestStart = new Promise<void>((resolve) => {
      tokenRequestStarted = resolve;
    });
    let createDevboxCalled = false;
    installFetchHandler((request) => {
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/devbox" && request.method === "GET") {
        return devboxEnvelope({ items: [] });
      }
      if (url.hostname === "aiproxy-web.test.sealos.io") {
        tokenRequestStarted();
        return new Promise<Response>((_resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => reject(request.signal.reason),
            { once: true }
          );
        });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "POST") {
        createDevboxCalled = true;
      }
      return new Response("unexpected request", { status: 500 });
    });

    const pending = ensureAiDeploymentDevbox({
      deadlineAtMs: Date.now() + 60_000,
      encodedKubeconfig: encodeURIComponent(kubeconfig()),
      kubeconfig: kubeconfig(),
      signal: controller.signal,
      task: githubTask(null),
      taskDeadlineAtMs: Date.now() + 60_000,
    });
    await tokenRequestStart;
    controller.abort(new Error("prepare deadline reached"));

    await expect(pending).rejects.toThrow("prepare deadline reached");
    expect(createDevboxCalled).toBe(false);
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
      taskDeadlineAtMs: Date.now() + 60_000,
    });

    expect(runtime.name).toBe("listed-devbox");
    expect(requests.map((request) => new URL(request.url).hostname)).toEqual([
      "devbox.test",
      "devbox.test",
      "devbox.test",
    ]);
  });

  it("rejects managed deployments without a Brain project ID", async () => {
    const task = githubTask(null);
    task.projectId = null;

    await expect(
      ensureAiDeploymentDevbox({
        encodedKubeconfig: encodeURIComponent(kubeconfig()),
        kubeconfig: kubeconfig(),
        task,
        taskDeadlineAtMs: Date.now() + 60_000,
      })
    ).rejects.toThrow("Managed deployment requires a Brain project ID.");
  });

  it("creates prompt deployment Devboxes with Agent and user AI Proxy env", async () => {
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
      task: promptTask(null),
      taskDeadlineAtMs: Date.now() + 60_000,
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
      SEALAI_DEPLOY_MODE: "managed",
      SEALAI_PROJECT_ID: "project-1",
      SEALAI_DEPLOY_LABELS_JSON: JSON.stringify({
        "brain.io/managed-by": "brain",
        "brain.io/project-id": "project-1",
        "brain.io/deployment-kind": "template",
      }),
    });
    expect(createdStorageLimit).toBe("10Gi");
  });

  it("injects GITHUB_DEPLOY_OPENAI_* into GitHub Devboxes and skips AI Proxy", async () => {
    process.env.GITHUB_DEPLOY_OPENAI_API_KEY = "github-override-key";
    process.env.GITHUB_DEPLOY_OPENAI_BASE_URL = "https://override.example/v1";
    const requests: Request[] = [];
    let createdEnv: Record<string, string> | undefined;
    installFetchHandler(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.pathname === "/api/v1/devbox" && request.method === "GET") {
        return devboxEnvelope({ items: [] });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "POST") {
        const body = (await request.json()) as {
          env?: Record<string, string>;
        };
        createdEnv = body.env;
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

    await ensureAiDeploymentDevbox({
      encodedKubeconfig: encodeURIComponent(kubeconfig()),
      kubeconfig: kubeconfig(),
      task: githubTask(null),
      taskDeadlineAtMs: Date.now() + 60_000,
    });

    expect(
      requests.some(
        (request) =>
          new URL(request.url).hostname === "aiproxy-web.test.sealos.io"
      )
    ).toBe(false);
    expect(createdEnv).toMatchObject({
      CODEX_GATEWAY_OPENAI_API_KEY: "github-override-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://override.example/v1",
    });
  });

  it("uses the caller's AI Proxy for GitHub Devboxes when GITHUB_DEPLOY_OPENAI_* is unset", async () => {
    const requests: Request[] = [];
    let createdEnv: Record<string, string> | undefined;
    installFetchHandler(async (request) => {
      requests.push(request);
      const url = new URL(request.url);
      if (url.hostname === "aiproxy-web.test.sealos.io") {
        return new Response(JSON.stringify({ key: "github-user-key" }), {
          status: 200,
        });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "GET") {
        return devboxEnvelope({ items: [] });
      }
      if (url.pathname === "/api/v1/devbox" && request.method === "POST") {
        const body = (await request.json()) as {
          env?: Record<string, string>;
        };
        createdEnv = body.env;
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

    await ensureAiDeploymentDevbox({
      encodedKubeconfig: encodeURIComponent(kubeconfig()),
      kubeconfig: kubeconfig(),
      task: githubTask(null),
      taskDeadlineAtMs: Date.now() + 60_000,
    });

    expect(
      requests.some(
        (request) =>
          new URL(request.url).hostname === "aiproxy-web.test.sealos.io"
      )
    ).toBe(true);
    expect(createdEnv).toMatchObject({
      CODEX_GATEWAY_OPENAI_API_KEY: "github-user-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://aiproxy.test.sealos.io/v1",
    });
    expect(Object.values(createdEnv ?? {})).not.toContain(
      "gateway-platform-key"
    );
    expect(Object.values(createdEnv ?? {})).not.toContain(
      "system-platform-key"
    );
  });

  it("does not apply GITHUB_DEPLOY_OPENAI_* to prompt deployments", async () => {
    process.env.GITHUB_DEPLOY_OPENAI_API_KEY = "github-override-key";
    process.env.GITHUB_DEPLOY_OPENAI_BASE_URL = "https://override.example/v1";
    let createdEnv: Record<string, string> | undefined;
    installFetchHandler(async (request) => {
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
        };
        createdEnv = body.env;
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

    await ensureAiDeploymentDevbox({
      encodedKubeconfig: encodeURIComponent(kubeconfig()),
      kubeconfig: kubeconfig(),
      task: promptTask(null),
      taskDeadlineAtMs: Date.now() + 60_000,
    });

    expect(createdEnv).toMatchObject({
      CODEX_GATEWAY_OPENAI_API_KEY: "new-user-key",
      CODEX_GATEWAY_OPENAI_BASE_URL: "https://aiproxy.test.sealos.io/v1",
    });
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

  it("classifies a failed Codex turn as an upstream execution error", () => {
    expect(
      codexGatewayFailureDetails(new CodexGatewayTurnError("failed"))
    ).toEqual({
      reason: "gateway-upstream-error",
    });
  });

  for (const [status, reason] of [
    ["cancelled", "cancelled"],
    ["interrupted", "interrupted"],
    ["unknown", "unknown"],
  ] as const) {
    it(`preserves the ${status} Codex turn reason`, () => {
      expect(
        codexGatewayFailureDetails(new CodexGatewayTurnError(status))
      ).toEqual({ reason });
    });
  }

  it("classifies fetch failures as unavailable", () => {
    expect(codexGatewayFailureDetails(new TypeError("fetch failed"))).toEqual({
      reason: "gateway-unavailable",
    });
  });

  it("persists only allowlisted gateway state metadata", () => {
    const snapshot = gatewayStateSnapshot({
      state: {
        activeTurn: false,
        currentTurnId: "turn_31",
        ready: true,
        recentEvents: [{ error: "Bearer private-token" }],
        startedAt: "2026-07-23T09:10:11.123Z",
        threadId: "019c8b28-d42a-7b60-8587-8a16b80f8b36",
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
      startedAt: "2026-07-23T09:10:11.123Z",
    });
    expect(JSON.stringify(snapshot)).not.toContain("turn_31");
    expect(JSON.stringify(snapshot)).not.toContain("019c8b28");
    expect(JSON.stringify(snapshot)).not.toContain("private-token");
    expect(JSON.stringify(snapshot)).not.toContain("private gateway stderr");
  });

  it("rejects injected values under allowlisted gateway state keys", () => {
    const privateValue = "Bearer private-token";
    const snapshot = gatewayStateSnapshot({
      state: {
        activeTurn: "true" as unknown as boolean,
        currentTurnId: { token: privateValue } as unknown as string,
        ready: { value: true } as unknown as boolean,
        startedAt: `2026-07-23T09:10:11.123Z\n${privateValue}`,
        threadId: privateValue,
      },
    });

    expect(snapshot).toMatchObject({
      activeTurn: false,
      ready: false,
      startedAt: null,
    });
    expect(JSON.stringify(snapshot)).not.toContain("private-token");

    const invalidFormats = gatewayStateSnapshot({
      state: {
        currentTurnId: `turn-${"x".repeat(129)}`,
        startedAt: "2026-02-31T09:10:11.123Z",
        threadId: "thread id with spaces",
      },
    });
    expect(invalidFormats).toMatchObject({
      startedAt: null,
    });
  });

  it("persists only sanitized gateway locators", () => {
    expect(safeGatewaySessionIdentifier("session-31")).toBe("session-31");
    expect(
      safeGatewaySessionIdentifier("019c8b28-d42a-7b60-8587-8a16b80f8b36")
    ).toBe("019c8b28-d42a-7b60-8587-8a16b80f8b36");
    expect(safeGatewaySessionIdentifier("AKIAIOSFODNN7EXAMPLE")).toBeNull();
    expect(
      safeGatewaySessionIdentifier("eyJhbGciOiJIUzI1NiJ9.payload.sig")
    ).toBeNull();
    expect(
      safeCodexGatewayUrl(
        "https://user:pass@gateway.test/base?token=private#raw"
      )
    ).toBe("https://gateway.test/base");
    expect(safeCodexGatewayUrl("javascript:alert(1)")).toBeNull();
  });

  it("maps untrusted gateway event names to a fixed projection", () => {
    expect([
      gatewayEventProjection("message"),
      gatewayEventProjection("session"),
      gatewayEventProjection("state"),
    ]).toEqual([
      {
        kind: "deploy_task.gateway_message",
        message: "Codex gateway message event received.",
        projectsState: false,
      },
      {
        kind: "deploy_task.gateway_session_event",
        message: "Codex gateway session event received.",
        projectsState: false,
      },
      {
        kind: "deploy_task.gateway_state",
        message: "Codex gateway state updated.",
        projectsState: true,
      },
    ]);

    const maliciousEventName =
      "state\nBearer private-token\ndeploy_task.gateway_injected";
    const projection = gatewayEventProjection(maliciousEventName);
    expect(projection).toEqual({
      kind: "deploy_task.gateway_event",
      message: "Codex gateway event received.",
      projectsState: false,
    });
    expect(JSON.stringify(projection)).not.toContain(maliciousEventName);
    expect(gatewayEventProjection("__proto__")).toEqual(projection);
  });
});
