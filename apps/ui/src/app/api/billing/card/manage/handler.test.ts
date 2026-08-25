import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountServiceRequest } from "@/lib/account-service/client-core";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import { createBillingCardManageHandler } from "./handler";

const VERIFIED_ACTOR = {
  actorBinding: {
    crName: "alice-cr",
    mintedAt: 1_753_600_000,
    userId: "user-alice",
    userUid: "uid-alice",
  },
  namespace: "workspace-a",
  ok: true,
  workspaceActor: "alice-cr",
} satisfies WorkspaceActorAuthorization;

function encodedKubeconfig(server: string): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: ${server}
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: workspace-a
      user: user
current-context: current
users:
  - name: user
    user:
      token: token
`);
}

function billingRequest(server: string) {
  return new Request("https://brain.example.test/api/billing/card/manage", {
    body: JSON.stringify({
      redirectUrl: "https://attacker.example.test",
      regionDomain: "us.example.test",
      workspace: "workspace-b",
    }),
    headers: {
      Authorization: `Bearer ${encodedKubeconfig(server)}`,
      "Content-Type": "application/json",
      "X-Sealos-App-Token": "desktop-app-token",
    },
    method: "POST",
  });
}

test("card management route binds the Brain return to the verified workspace", async () => {
  let accountRequest: AccountServiceRequest | undefined;
  const handler = createBillingCardManageHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: (request) => {
      accountRequest = request;
      return Promise.resolve(
        Response.json({
          success: true,
          url: "https://checkout.stripe.test/setup",
        })
      );
    },
  });

  const response = await handler(
    billingRequest("https://us.example.test:6443")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    url: "https://checkout.stripe.test/setup",
  });
  assert.deepEqual(accountRequest?.actor, {
    userId: "user-alice",
    userUid: "uid-alice",
  });
  assert.equal(accountRequest?.init?.method, "POST");
  assert.equal(
    accountRequest?.pathname,
    "/account/v1alpha1/workspace-subscription/card-manage"
  );
  assert.deepEqual(JSON.parse(String(accountRequest?.init?.body)), {
    redirectUrl:
      "https://us.example.test/?openapp=system-brain%3F%2Fbilling%3F",
    regionDomain: "us.example.test",
    workspace: "workspace-a",
  });
});

test("card management route rejects a kubeconfig without a desktop routing origin", async () => {
  let accountCalls = 0;
  const handler = createBillingCardManageHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: () => {
      accountCalls += 1;
      return Promise.resolve(Response.json({ success: true }));
    },
  });

  const response = await handler(billingRequest("https://[2001:db8::1]"));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Billing desktop origin is unavailable.",
  });
  assert.equal(accountCalls, 0);
});
