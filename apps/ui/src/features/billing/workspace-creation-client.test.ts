import assert from "node:assert/strict";
import { test } from "node:test";

import type { BillingFetch } from "./billing-data-client";
import {
  createWorkspaceWithSubscription,
  retryWorkspaceCreationPayment,
  WorkspaceNameConflictError,
} from "./workspace-creation-client";
import { WORKSPACE_NAME_CONFLICT_CODE } from "./workspace-creation-schema";

const CREDENTIALS = { appToken: "desktop-app-token", kubeconfig: "kc" };

function recordingFetch(respond: () => Response) {
  const calls: {
    body: unknown;
    headers: Headers;
    method: string;
    url: string;
  }[] = [];
  const fetch: BillingFetch = (input, init) => {
    calls.push({
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init?.headers),
      method: init?.method ?? "GET",
      url: String(input),
    });
    return Promise.resolve(respond());
  };
  return { calls, fetch };
}

test("createWorkspaceWithSubscription posts the name and plan with the credentials and parses the answer", async () => {
  const { calls, fetch } = recordingFetch(() =>
    Response.json({
      payment: {
        invoiceId: "inv-1",
        payId: "pay-1",
        redirectUrl: "https://checkout.stripe.test/inv-1",
        status: "started",
      },
      workspace: { id: "ns-new", name: "Robotics", uid: "uid-new" },
    })
  );
  const result = await createWorkspaceWithSubscription(
    {
      ...CREDENTIALS,
      name: "Robotics",
      planName: "Pro",
      regionDomain: "us.example.test",
    },
    { fetch }
  );
  assert.deepEqual(result, {
    payment: {
      invoiceId: "inv-1",
      payId: "pay-1",
      redirectUrl: "https://checkout.stripe.test/inv-1",
      status: "started",
    },
    workspace: { id: "ns-new", name: "Robotics", uid: "uid-new" },
  });
  assert.equal(calls[0]?.url, "/api/billing/workspace-create");
  assert.equal(calls[0]?.method, "POST");
  assert.equal(
    calls[0]?.headers.get("X-Sealos-App-Token"),
    "desktop-app-token"
  );
  assert.deepEqual(calls[0]?.body, {
    name: "Robotics",
    payMethod: "stripe",
    period: "1m",
    planName: "Pro",
    regionDomain: "us.example.test",
  });
});

test("a 409 from the route is the name conflict, distinguishable from other failures", async () => {
  const { fetch } = recordingFetch(() =>
    Response.json(
      { code: WORKSPACE_NAME_CONFLICT_CODE, error: "taken" },
      { status: 409 }
    )
  );
  await assert.rejects(
    createWorkspaceWithSubscription(
      {
        ...CREDENTIALS,
        name: "Robotics",
        planName: "Pro",
        regionDomain: "us.example.test",
      },
      { fetch }
    ),
    WorkspaceNameConflictError
  );

  const refused = recordingFetch(() =>
    Response.json(
      { error: "Desktop refused to create the Workspace." },
      {
        status: 403,
      }
    )
  );
  await assert.rejects(
    createWorkspaceWithSubscription(
      {
        ...CREDENTIALS,
        name: "Robotics",
        planName: "Pro",
        regionDomain: "us.example.test",
      },
      { fetch: refused.fetch }
    ),
    (error: unknown) =>
      !(error instanceof WorkspaceNameConflictError) &&
      error instanceof Error &&
      error.message === "Desktop refused to create the Workspace."
  );
});

test("retryWorkspaceCreationPayment posts the created Workspace's id and parses the payment", async () => {
  const { calls, fetch } = recordingFetch(() =>
    Response.json({ payment: { error: "card declined", status: "failed" } })
  );
  const result = await retryWorkspaceCreationPayment(
    {
      ...CREDENTIALS,
      planName: "Pro",
      regionDomain: "us.example.test",
      workspaceId: "ns-new",
    },
    { fetch }
  );
  assert.deepEqual(result, { error: "card declined", status: "failed" });
  assert.equal(calls[0]?.url, "/api/billing/workspace-create/retry-payment");
  assert.deepEqual(calls[0]?.body, {
    payMethod: "stripe",
    period: "1m",
    planName: "Pro",
    regionDomain: "us.example.test",
    workspaceId: "ns-new",
  });
});
