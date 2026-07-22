import assert from "node:assert/strict";
import { test } from "node:test";

import { createDeployTaskInputSchema } from "./types";

test("deployment creation strips legacy client-owned identity selectors", () => {
  const parsed = createDeployTaskInputSchema.parse({
    actorUserId: "desktop-user",
    githubConnectionId: "connection-mallory",
    namespace: "shared-workspace",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: {
      kind: "github",
      repo: {
        fullName: "alice/example",
        name: "example",
        url: "https://github.com/alice/example",
      },
    },
    target: { kind: "existingProject", projectId: "project-test" },
  });

  assert.equal("actorUserId" in parsed, false);
  assert.equal("githubConnectionId" in parsed, false);
});
