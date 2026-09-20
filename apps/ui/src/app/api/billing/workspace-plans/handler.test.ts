import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountServiceRequest } from "@/lib/account-service/client-core";

import { createWorkspacePlansHandler } from "./handler";

const ACTOR_OK = () =>
  Promise.resolve({
    actorBinding: {
      crName: "alice-cr",
      mintedAt: 1_753_600_000,
      userId: "user-alice",
      userUid: "uid-alice",
    },
    namespace: "ns-alice",
    ok: true as const,
    workspaceActor: "alice-cr",
  });

function plansRequest(workspaces: string[]) {
  const url = new URL("https://brain.example.test/api/billing/workspace-plans");
  for (const workspace of workspaces) {
    url.searchParams.append("workspace", workspace);
  }
  return new Request(url, {
    headers: {
      Authorization: "Bearer encoded-kubeconfig",
      "X-Sealos-App-Token": "desktop-app-token",
    },
  });
}

function subscriptionAnswers(
  answers: Record<string, unknown>
): (request: AccountServiceRequest) => Promise<Response> {
  return (request) => {
    const body = JSON.parse(String(request.init?.body)) as {
      workspace: string;
    };
    const answer = answers[body.workspace];
    if (answer instanceof Response) {
      return Promise.resolve(answer);
    }
    return Promise.resolve(Response.json({ subscription: answer }));
  };
}

test("reads each requested Workspace's plan name as the verified actor; no subscription reads as null", async () => {
  const calls: AccountServiceRequest[] = [];
  const handler = createWorkspacePlansHandler({
    authorizeWorkspaceActor: ACTOR_OK,
    regionDomain: () => "region.test",
    requestAccountService: (request) => {
      calls.push(request);
      return subscriptionAnswers({
        "ns-alice": { PlanName: "Pro", Status: "NORMAL", type: "SUBSCRIPTION" },
        "ns-deleted": {
          PlanName: "Hobby",
          Status: "DELETED",
          type: "SUBSCRIPTION",
        },
        "ns-payg": { type: "PAYG" },
      })(request);
    },
  });

  const response = await handler(
    plansRequest(["ns-alice", "ns-payg", "ns-deleted"])
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    plans: { "ns-alice": "Pro", "ns-deleted": null, "ns-payg": null },
  });
  assert.deepEqual(
    calls.map((call) => [
      call.pathname,
      call.actor,
      JSON.parse(String(call.init?.body)),
    ]),
    ["ns-alice", "ns-payg", "ns-deleted"].map((workspace) => [
      "/account/v1alpha1/workspace-subscription/info",
      { userId: "user-alice", userUid: "uid-alice" },
      { regionDomain: "region.test", workspace },
    ])
  );
});

test("a Workspace whose read is refused or fails answers null alone", async () => {
  const handler = createWorkspacePlansHandler({
    authorizeWorkspaceActor: ACTOR_OK,
    regionDomain: () => "region.test",
    requestAccountService: subscriptionAnswers({
      "ns-alice": { PlanName: "Pro", type: "SUBSCRIPTION" },
      // account-service answers 401 for a non-member's read.
      "ns-other": Response.json({ error: "no permission" }, { status: 401 }),
    }),
  });
  const response = await handler(plansRequest(["ns-alice", "ns-other"]));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    plans: { "ns-alice": "Pro", "ns-other": null },
  });
});

test("answers 400 without a Workspace to read and 401 without a proven binding", async () => {
  const handler = createWorkspacePlansHandler({
    authorizeWorkspaceActor: ACTOR_OK,
    regionDomain: () => "region.test",
    requestAccountService: () => {
      throw new Error("must not read");
    },
  });
  assert.equal((await handler(plansRequest([]))).status, 400);

  const unauthorized = createWorkspacePlansHandler({
    authorizeWorkspaceActor: () =>
      Promise.resolve({
        code: "app_token_required",
        message: "Authentication is required.",
        ok: false,
        status: 401,
      }),
    regionDomain: () => "region.test",
    requestAccountService: () => {
      throw new Error("must not read");
    },
  });
  assert.equal((await unauthorized(plansRequest(["ns-alice"]))).status, 401);
});

test("answers 503 when the region domain is not configured", async () => {
  const handler = createWorkspacePlansHandler({
    authorizeWorkspaceActor: ACTOR_OK,
    regionDomain: () => "",
    requestAccountService: () => {
      throw new Error("must not read");
    },
  });
  assert.equal((await handler(plansRequest(["ns-alice"]))).status, 503);
});
