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

test("deployment creation accepts one consistent GitHub repository identity", () => {
  const parsed = createDeployTaskInputSchema.safeParse({
    namespace: "shared-workspace",
    runner: { kind: "ai", runtimeProvider: "devbox" },
    source: {
      kind: "github",
      repo: {
        fullName: "Acme/Example",
        name: "Example",
        url: "https://github.com/acme/example.git",
      },
    },
    target: { kind: "existingProject", projectId: "project-test" },
  });

  assert.equal(parsed.success, true);
});

test("deployment creation rejects inconsistent GitHub repository fields", () => {
  const repositories = [
    {
      fullName: "public/example",
      name: "example",
      url: "https://github.com/private/other",
    },
    {
      fullName: "acme/example",
      name: "other",
      url: "https://github.com/acme/example",
    },
    {
      fullName: "acme/example",
      name: "example",
      url: "https://example.com/acme/example",
    },
    {
      fullName: "acme/example",
      name: "example",
      url: "https://github.com/acme/example/tree/main",
    },
  ];

  for (const repo of repositories) {
    const parsed = createDeployTaskInputSchema.safeParse({
      namespace: "shared-workspace",
      runner: { kind: "ai", runtimeProvider: "devbox" },
      source: { kind: "github", repo },
      target: { kind: "existingProject", projectId: "project-test" },
    });

    assert.equal(parsed.success, false, JSON.stringify(repo));
  }
});
