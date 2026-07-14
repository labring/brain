import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_DOCKER_APP_LISTENING_PORT } from "@/features/deploy/docker-deployment-settings";

import { createDeployTaskToolInputSchema } from "./chat-deploy-task-input";

test("chat createDeployTask defaults minimal Docker image settings", () => {
  const parsed = createDeployTaskToolInputSchema.safeParse({
    intention: "deploy official nginx image into current project",
    source: {
      kind: "docker",
      settings: {
        image: "nginx:latest",
      },
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.equal(parsed.data.source.kind, "docker");
  assert.deepEqual(parsed.data.source.settings, {
    appListeningPort: DEFAULT_DOCKER_APP_LISTENING_PORT,
    env: [],
    image: "nginx:latest",
  });
});

test("chat createDeployTask ignores model-provided raw runner fields", () => {
  const parsed = createDeployTaskToolInputSchema.safeParse({
    intention: "deploy official nginx image into current project",
    runner: { kind: "deterministic" },
    source: {
      kind: "docker",
      settings: {
        image: "nginx:latest",
      },
    },
  });

  assert.equal(parsed.success, true);
  if (!parsed.success) {
    return;
  }
  assert.equal("runner" in parsed.data, false);
  assert.equal(parsed.data.source.kind, "docker");
  assert.equal(
    parsed.data.source.settings.appListeningPort,
    DEFAULT_DOCKER_APP_LISTENING_PORT
  );
});
