import assert from "node:assert/strict";
import { test } from "node:test";

import type { AccountServiceRequest } from "@/lib/account-service/client-core";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import { createBillingSubscriptionPayHandler } from "./handler";

function billingRequest(body: unknown) {
  return new Request(
    "https://brain.example.test/api/billing/subscription/pay",
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: "Bearer encoded-kubeconfig",
        "Content-Type": "application/json",
        "X-Sealos-App-Token": "desktop-app-token",
      },
      method: "POST",
    }
  );
}

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

test("subscription pay route sends cancel and resume as the verified actor", async () => {
  const accountRequests: AccountServiceRequest[] = [];
  const handler = createBillingSubscriptionPayHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: (request) => {
      accountRequests.push(request);
      return Promise.resolve(Response.json({ success: true }));
    },
  });

  for (const operator of ["canceled", "resumed"] as const) {
    const response = await handler(
      billingRequest({
        createWorkspace: {
          teamName: "must-not-pass",
          userType: "subscription",
        },
        operator,
        payApp: "system-costcenter",
        payMethod: "stripe",
        planName: "Pro",
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
  }

  assert.equal(accountRequests.length, 2);
  for (const [index, operator] of ["canceled", "resumed"].entries()) {
    const request = accountRequests[index];
    assert.deepEqual(request?.actor, {
      userId: "user-alice",
      userUid: "uid-alice",
    });
    assert.equal(
      request?.pathname,
      "/account/v1alpha1/workspace-subscription/pay"
    );
    assert.equal(request?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), {
      operator,
      payApp: "system-brain",
      payMethod: "stripe",
      planName: "Pro",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    });
  }
});

test("subscription pay route declares Brain and returns checkout URLs for paid plan changes", async () => {
  const accountRequests: AccountServiceRequest[] = [];
  const handler = createBillingSubscriptionPayHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: (request) => {
      accountRequests.push(request);
      return Promise.resolve(
        Response.json({
          invoiceID: "invoice-1",
          redirectUrl: "https://checkout.stripe.test/invoice-1",
          success: true,
        })
      );
    },
  });

  for (const operator of [
    "created",
    "upgraded",
    "downgraded",
    "renewed",
  ] as const) {
    const response = await handler(
      billingRequest({
        createWorkspace: {
          teamName: "must-not-pass",
          userType: "subscription",
        },
        operator,
        payApp: "system-costcenter",
        payMethod: "stripe",
        period: "1m",
        planName: "Team",
        promotionCode: "SAVE20",
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      invoiceID: "invoice-1",
      redirectUrl: "https://checkout.stripe.test/invoice-1",
      success: true,
    });
  }

  assert.equal(accountRequests.length, 4);
  for (const [index, operator] of [
    "created",
    "upgraded",
    "downgraded",
    "renewed",
  ].entries()) {
    assert.deepEqual(JSON.parse(String(accountRequests[index]?.init?.body)), {
      operator,
      payApp: "system-brain",
      payMethod: "stripe",
      period: "1m",
      planName: "Team",
      promotionCode: "SAVE20",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    });
  }
});

test("subscription pay route rejects created without a billing period", async () => {
  let accountCalls = 0;
  const handler = createBillingSubscriptionPayHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: () => {
      accountCalls += 1;
      return Promise.resolve(Response.json({ success: true }));
    },
  });

  const response = await handler(
    billingRequest({
      operator: "created",
      payMethod: "stripe",
      planName: "Pro",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid subscription payment request.",
  });
  assert.equal(accountCalls, 0);
});

test("subscription pay route requires workspace and rejects blank values", async () => {
  let accountCalls = 0;
  const handler = createBillingSubscriptionPayHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService: () => {
      accountCalls += 1;
      return Promise.resolve(Response.json({ success: true }));
    },
  });

  for (const workspace of [undefined, "  "]) {
    const response = await handler(
      billingRequest({
        operator: "canceled",
        payMethod: "stripe",
        planName: "Pro",
        regionDomain: "us.example.test",
        workspace,
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Invalid subscription payment request.",
    });
  }
  assert.equal(accountCalls, 0);
});

test("subscription pay route refuses failed actor bindings without fallback", async () => {
  let accountCalls = 0;
  const handler = createBillingSubscriptionPayHandler({
    authorizeWorkspaceActor: () =>
      Promise.resolve({
        code: "app_token_mismatch",
        message: "App token does not match the authenticated actor.",
        ok: false,
        status: 403,
      }),
    requestAccountService: () => {
      accountCalls += 1;
      return Promise.resolve(Response.json({ success: true }));
    },
  });

  const response = await handler(
    billingRequest({
      operator: "resumed",
      payMethod: "stripe",
      planName: "Pro",
      regionDomain: "us.example.test",
      workspace: "workspace-a",
    })
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "Authentication is required.",
  });
  assert.equal(accountCalls, 0);
});
