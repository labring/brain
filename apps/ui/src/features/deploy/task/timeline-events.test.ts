import { afterAll, expect, it, mock } from "bun:test";
import { createRequire } from "node:module";

const requireModule = createRequire(import.meta.url);

mock.module("server-only", () => ({}));

const realEngineServer = requireModule(
  "./engine/server"
) as typeof import("./engine/server");

mock.module("./engine/server", () => ({
  getDeployTaskEngineContext: () => ({
    notify: {
      publish: () => Promise.resolve(),
      subscribe: () => Promise.reject(new Error("LISTEN refused")),
    },
  }),
}));

const { subscribeDeploymentTaskTimelineEvents } = requireModule(
  "./timeline-events"
) as typeof import("./timeline-events");

afterAll(() => {
  mock.module("./engine/server", () => ({ ...realEngineServer }));
});

it("rejects ready when the notify subscribe fails", async () => {
  const subscription = subscribeDeploymentTaskTimelineEvents({
    listener: () => undefined,
    namespace: "ns-test",
    taskId: "task-a",
  });

  await expect(subscription.ready).rejects.toThrow("LISTEN refused");
  subscription.unsubscribe();
});
