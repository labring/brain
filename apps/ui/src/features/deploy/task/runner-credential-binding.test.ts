import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGithubTokenForDeploymentTask } from "./credential-binding";

describe("deployment task runner credential binding", () => {
  it("resolves only the GitHub credential persisted on the task", async () => {
    const lookups: unknown[] = [];
    const task = {
      // Compatibility fields are deliberately foreign. They must never select
      // the runner credential once the immutable binding exists.
      actorUserId: "foreign-desktop-user",
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "alice-cr",
        version: 1,
      },
      githubConnectionId: "connection-mallory",
      namespace: "shared-workspace",
      source: {
        kind: "github" as const,
        repo: {
          fullName: "alice/example",
          name: "example",
          url: "https://github.com/alice/example",
        },
      },
    };

    const token = await resolveGithubTokenForDeploymentTask(task, (input) => {
      lookups.push(input);
      return Promise.resolve("alice-token");
    });

    assert.equal(token, "alice-token");
    assert.deepEqual(lookups, [
      {
        connectionRef: "connection-alice",
        credentialOwner: "alice-cr",
        namespace: "shared-workspace",
        ownerIdentityVersion: 1,
      },
    ]);
  });
});
