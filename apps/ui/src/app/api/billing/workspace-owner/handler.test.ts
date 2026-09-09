import assert from "node:assert/strict";
import { test } from "node:test";

import { createWorkspaceOwnerHandler } from "./handler";

function ownerRequest() {
  return new Request("https://brain.example.test/api/billing/workspace-owner", {
    headers: {
      Authorization: "Bearer encoded-kubeconfig",
      "X-Sealos-App-Token": "desktop-app-token",
    },
  });
}

test("workspace owner route judges the namespace against the verified crName, never a client claim", async () => {
  let read: unknown;
  const handler = createWorkspaceOwnerHandler({
    authorizeWorkspaceActor: () =>
      Promise.resolve({
        actorBinding: {
          crName: "alice-cr",
          mintedAt: 1_753_600_000,
          userId: "user-alice",
          userUid: "uid-alice",
        },
        namespace: "ns-alice",
        ok: true,
        workspaceActor: "alice-cr",
      }),
    readWorkspaceOwnerStanding: (input) => {
      read = input;
      return Promise.resolve({ isOwner: true, platformDebt: false });
    },
  });

  const response = await handler(ownerRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    isOwner: true,
    platformDebt: false,
  });
  assert.deepEqual(read, {
    crName: "alice-cr",
    encodedKubeconfig: "encoded-kubeconfig",
    namespace: "ns-alice",
  });
});

test("workspace owner route answers 401 without a proven binding", async () => {
  const handler = createWorkspaceOwnerHandler({
    authorizeWorkspaceActor: () =>
      Promise.resolve({
        code: "app_token_required",
        message: "Authentication is required.",
        ok: false,
        status: 401,
      }),
    readWorkspaceOwnerStanding: () => {
      throw new Error("must not read");
    },
  });
  const response = await handler(ownerRequest());
  assert.equal(response.status, 401);
});
