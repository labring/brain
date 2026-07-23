// @ts-expect-error bun exposes mock at runtime; direct tsc in this repo lacks bun:test types.
import { afterAll, beforeEach, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);
const originalFetch = globalThis.fetch;

mock.module("server-only", () => ({}));

const realApiAuth = requireModule(
  "@/features/deploy/task/api-auth"
) as typeof import("@/features/deploy/task/api-auth");
const realGateway = requireModule(
  "@/features/deploy/task/gateway"
) as typeof import("@/features/deploy/task/gateway");
const realService = requireModule(
  "@/features/deploy/task/service"
) as typeof import("@/features/deploy/task/service");
const realDevboxClient = requireModule(
  "@/lib/devbox/client"
) as typeof import("@/lib/devbox/client");

const persistedGatewayEvents: Record<string, unknown>[] = [];

mock.module("@/features/deploy/task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: "ns-test",
    ok: true as const,
  }),
}));
mock.module("@/features/deploy/task/gateway", () => ({
  getCodexGatewayContextFromDevboxInfo: () => ({
    authToken: null,
    url: "https://gateway.internal",
  }),
  getCodexGatewayEventStreamUrl: () =>
    "https://gateway.internal/api/sessions/session-safe/events",
  persistDeployGatewayEvent: (input: Record<string, unknown>) => {
    persistedGatewayEvents.push(input);
    return Promise.resolve();
  },
  safeGatewaySessionIdentifier: () => "session-safe",
}));
mock.module("@/features/deploy/task/service", () => ({
  getDeployTaskByIdInNamespace: async () => ({
    gatewaySessionId: "session-safe",
    runner: { kind: "ai" },
    runtimeName: "runtime-safe",
  }),
  getDeployTaskSnapshot: async () => ({
    events: [],
    task: { id: "task-safe", status: "running" },
    timeline: null,
  }),
}));
mock.module("@/lib/devbox/client", () => ({
  getDevbox: async () => ({ data: {} }),
}));

afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.module("@/features/deploy/task/api-auth", () => ({ ...realApiAuth }));
  mock.module("@/features/deploy/task/gateway", () => ({ ...realGateway }));
  mock.module("@/features/deploy/task/service", () => ({ ...realService }));
  mock.module("@/lib/devbox/client", () => ({ ...realDevboxClient }));
});

beforeEach(() => {
  persistedGatewayEvents.length = 0;
});

it("forwards only an empty invalidation for raw Gateway SSE payloads", async () => {
  const privateToken = "private-gateway-token";
  const privateError = "private command output";
  const upstreamEventName = "state-private-event";
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(
        [
          `event: ${upstreamEventName}`,
          `data: ${JSON.stringify({ error: privateError, token: privateToken })}`,
          "",
          "",
        ].join("\n"),
        {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }
      )
    )) as typeof fetch;

  const { GET } = await import("./route");
  const response = await GET(
    new Request("https://brain.test/api/deploy-tasks/task-safe/events"),
    { params: Promise.resolve({ taskId: "task-safe" }) }
  );
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain('event: snapshot\ndata: {"events":[]');
  expect(body).toContain("event: gateway-update\ndata: {}\n\n");
  expect(body).not.toContain(privateToken);
  expect(body).not.toContain(privateError);
  expect(body).not.toContain(upstreamEventName);
  expect(persistedGatewayEvents).toEqual([
    {
      eventName: upstreamEventName,
      payload: { error: privateError, token: privateToken },
      taskId: "task-safe",
    },
  ]);
});
