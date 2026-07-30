import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountServiceRequest } from "@/lib/account-service/client-core";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import { createBillingAccountHandler } from "./handler";

const ACCOUNT_RESPONSE = {
  account: {
    Balance: 4_200_000,
    DeductionBalance: 1_200_000,
  },
};

function billingRequest() {
  return new Request("https://brain.example.test/api/billing/account", {
    headers: {
      Authorization: "Bearer encoded-kubeconfig",
      "X-Sealos-App-Token": "desktop-app-token",
    },
  });
}

test("billing account route calls account-service as the verified Workspace Actor", async () => {
  let authorizationInput:
    | { appToken: string | undefined; encodedKubeconfig: string | undefined }
    | undefined;
  let accountRequest: AccountServiceRequest | undefined;
  const handler = createBillingAccountHandler({
    authorizeWorkspaceActor: (input) => {
      authorizationInput = input;
      return Promise.resolve({
        actorBinding: {
          crName: "alice-cr",
          mintedAt: 1_753_600_000,
          userId: "user-alice",
          userUid: "uid-alice",
        },
        namespace: "workspace-a",
        ok: true,
        workspaceActor: "alice-cr",
      });
    },
    requestAccountService: (request) => {
      accountRequest = request;
      return Promise.resolve(Response.json(ACCOUNT_RESPONSE));
    },
  });

  const response = await handler(billingRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), ACCOUNT_RESPONSE);
  assert.deepEqual(authorizationInput, {
    appToken: "desktop-app-token",
    encodedKubeconfig: "encoded-kubeconfig",
  });
  assert.deepEqual(accountRequest, {
    actor: { userId: "user-alice", userUid: "uid-alice" },
    init: { body: "{}", method: "POST" },
    pathname: "/account/v1alpha1/account",
  });
});

test("billing account route maps failed or incomplete bindings to 401 without fallback", async () => {
  const authorizationResults: WorkspaceActorAuthorization[] = [
    {
      code: "app_token_mismatch",
      message: "App token does not match the authenticated actor.",
      ok: false,
      status: 403,
    },
    {
      actorBinding: {
        crName: "alice-cr",
        mintedAt: 1_753_600_000,
        userId: null,
        userUid: "uid-alice",
      },
      namespace: "workspace-a",
      ok: true,
      workspaceActor: "alice-cr",
    },
  ];
  let accountCalls = 0;

  for (const authorization of authorizationResults) {
    const handler = createBillingAccountHandler({
      authorizeWorkspaceActor: () => Promise.resolve(authorization),
      requestAccountService: () => {
        accountCalls += 1;
        return Promise.resolve(Response.json(ACCOUNT_RESPONSE));
      },
    });

    const response = await handler(billingRequest());

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Authentication is required.",
    });
  }
  assert.equal(accountCalls, 0);
});
