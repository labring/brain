import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGithubTokenForDeploymentTask } from "./credential-binding";

const INVALIDATED_CONNECTION_ERROR =
  /GitHub OAuth connection is not authorized for this deployment\./;

describe("deployment task runner credential binding", () => {
  it("resolves only the GitHub credential persisted on the task", async () => {
    const lookups: unknown[] = [];
    const task = {
      // Compatibility fields are deliberately foreign. They must never select
      // the runner credential once the immutable binding exists.
      actorUserId: "foreign-desktop-user",
      // A current binding's owner is the initiator's global userUid
      // (ADR-0059); crName-owned bindings are history.
      credentialBinding: {
        connectionRef: "connection-alice",
        credentialOwner: "uid-alice",
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
        credentialOwner: "uid-alice",
        namespace: "shared-workspace",
        ownerIdentityVersion: 2,
      },
    ]);
  });

  it("fails explicitly when a historical task's persisted credential was invalidated", async () => {
    await assert.rejects(
      resolveGithubTokenForDeploymentTask(
        {
          credentialBinding: {
            connectionRef: "connection-cleared-by-migration",
            credentialOwner: "alice-cr",
            version: 1,
          },
          namespace: "shared-workspace",
          source: {
            kind: "github",
            repo: {
              fullName: "alice/example",
              name: "example",
              url: "https://github.com/alice/example",
            },
          },
        },
        () => Promise.resolve(null)
      ),
      INVALIDATED_CONNECTION_ERROR
    );
  });
});
