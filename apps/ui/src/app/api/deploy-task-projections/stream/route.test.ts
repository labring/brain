import { afterAll, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const realApiAuth = requireModule(
  "@/features/deploy/task/api-auth"
) as typeof import("@/features/deploy/task/api-auth");
const realEngineServer = requireModule(
  "@/features/deploy/task/engine/server"
) as typeof import("@/features/deploy/task/engine/server");
const realService = requireModule(
  "@/features/deploy/task/service"
) as typeof import("@/features/deploy/task/service");

mock.module("@/features/deploy/task/api-auth", () => ({
  deployTaskRequestParams: () => ({}),
  resolveDeployTaskRequestNamespace: async () => ({
    namespace: "ns-test",
    ok: true as const,
  }),
}));
mock.module("@/features/deploy/task/engine/server", () => ({
  getDeployTaskEngineContext: () => ({
    notify: {
      publish: () => Promise.resolve(),
      subscribe: () => Promise.reject(new Error("LISTEN connection refused")),
    },
  }),
}));
mock.module("@/features/deploy/task/service", () => ({
  getDeployTaskById: async () => null,
  listDeploymentTaskProjections: async () => [],
}));

afterAll(() => {
  mock.module("@/features/deploy/task/api-auth", () => ({ ...realApiAuth }));
  mock.module("@/features/deploy/task/engine/server", () => ({
    ...realEngineServer,
  }));
  mock.module("@/features/deploy/task/service", () => ({ ...realService }));
});

it("sends an error event and closes when the initial LISTEN fails", async () => {
  const { GET } = await import("./route");
  const response = await GET(
    new Request(
      "https://brain.test/api/deploy-task-projections/stream?projectId=project-a"
    )
  );
  // text() resolves only if the route closes the stream — a hang here is the
  // zombie-stream regression this test exists for.
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(body).toContain("event: error");
  expect(body).toContain("LISTEN connection refused");
  expect(body).not.toContain("event: snapshot");
});
